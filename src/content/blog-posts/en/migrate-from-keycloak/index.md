---
title: "Migrating Off Keycloak Without Resetting Passwords"
excerpt: "A practical Keycloak migration plan: take an inventory, export users with their password hashes, move OIDC and SAML clients, pick a cut-over strategy, and test a rollback before you need it."
coverImage: ./cover.webp
publishedAt: 2026-11-15
metaTitle: "Keycloak Migration: Move Off Keycloak, Keep Passwords"
metaDescription: "Migrate off Keycloak: export users and password hashes with kc.sh, move OIDC and SAML clients, choose big bang or phased cut-over, and plan rollback."
category: engineering
readTime: 10
faq:
  - q: "Can I export Keycloak users with their passwords?"
    a: "Yes, with the kc.sh export command run against a stopped server. It writes users and their stored password hashes to JSON. The partial export in the Admin Console does not include users and masks secrets, so it is no use for a migration."
  - q: "What password hashing does Keycloak use?"
    a: "Argon2 by default since Keycloak 25, outside FIPS mode. Keycloak 24 used PBKDF2-SHA512, and Keycloak 20 to 23 used PBKDF2-SHA256. A user's hash is only updated when they next sign in with a password, so most realms hold a mix."
  - q: "Will users have to reset their passwords when we leave Keycloak?"
    a: "Only if the new system cannot verify their existing hashes. Count the hash algorithms in your export first, then check that your target supports each one."
  - q: "Should we migrate everyone at once or in phases?"
    a: "A big bang cut-over is simpler when you have a few apps and can accept a short maintenance window. A phased migration, one app or user group at a time, suits larger estates but means running both systems for longer."
---

> **tl;dr:** To migrate off Keycloak without password resets, export each realm with `kc.sh export` on a stopped server, check which hash algorithms your users actually have, and import them into a system that can verify those hashes. Then repoint your OIDC and SAML clients, cut over in one go or in phases, and keep Keycloak and its database ready for a rollback.

Most Keycloak migrations go wrong on the details. Users are easy to export. What catches teams out is a realm full of old password hashes, an app that reads Keycloak-specific role claims, or a SAML partner who needs two weeks' notice to change a certificate.

This guide is a plan you can follow whatever you move to. It's based on the Keycloak 26.8 documentation, current in November 2026. If you're upgrading Keycloak rather than leaving it, read our [Keycloak upgrade guide](/post/keycloak-upgrade-guide/) instead.

## Step 1: Take an inventory

Before you export anything, write down what you have. Keycloak's admin CLI makes this quick. Log in once, then query each realm:

```bash
# Log in to the admin CLI
bin/kcadm.sh config credentials --server https://sso.example.com \
  --realm master --user admin

# Clients, their protocol and redirect URIs
bin/kcadm.sh get clients -r myrealm --fields clientId,protocol,redirectUris

# Upstream identity providers (Google, Entra ID, other SAML IdPs)
bin/kcadm.sh get identity-provider/instances -r myrealm --fields alias,providerId

# User federation (LDAP, Kerberos, custom user storage)
bin/kcadm.sh get components -r myrealm \
  -q type=org.keycloak.storage.UserStorageProvider --fields name,providerId
```

Your list should cover:

- **Realms.** Each one is a separate user base with its own settings.
- **Clients.** Every app, API and service account, with its protocol, redirect URIs, scopes and protocol mappers.
- **Identity providers.** Social logins and enterprise IdPs your users sign in through.
- **User federation.** If users live in LDAP or Active Directory, their passwords are there, not in Keycloak.
- **Authentication flows and required actions.** Custom flows, MFA rules, terms acceptance, email verification.
- **Custom themes.** Every overridden template and message bundle. Our [custom login page guide](/post/keycloak-custom-login-page/) explains where these live.
- **Custom providers (SPIs).** Java extensions for event listeners, mappers, authenticators or user storage. Each one is behaviour you need to rebuild or drop.
- **Token consumers.** Every service that validates Keycloak tokens, and which claims it reads.

The last two items usually take the longest. Custom SPIs hold business logic nobody has documented, and token consumers are often in repos owned by other teams.

## Step 2: Export users and password hashes

Keycloak gives you three ways to get data out. Only one of them includes password hashes.

- **Admin Console partial export.** Exports realm settings, clients, roles and groups. It cannot export users, and it masks passwords and client secrets with `*`. Keycloak's docs say it's not suitable for moving data between servers.
- **Admin REST API.** Lists users and their attributes. It shows each password's algorithm, but it does not return the stored hash or salt.
- **`kc.sh export`.** Writes realms, clients and users, including their credentials, to JSON files. Use this one.

The [import and export guide](https://www.keycloak.org/server/importExport) says the server instance must not be running when you invoke the command, and recommends stopping all nodes so the export is consistent. In practice, run the export in a maintenance window, or against a restored copy of the production database. Pass the same database options your server uses:

```bash
bin/kc.sh export \
  --dir /tmp/kc-export \
  --realm myrealm \
  --users different_files \
  --users-per-file 1000 \
  --db postgres \
  --db-url jdbc:postgresql://db.internal:5432/keycloak \
  --db-username keycloak \
  --db-password "$KC_DB_PASSWORD"
```

A few things to know:

- **`--users`** accepts `different_files` (the default), `same_file`, `realm_file` or `skip`. The default writes 50 users per file unless you set `--users-per-file`.
- **Use `--dir`, not `--file`, for large realms.** The docs say to export to a directory if you have more than 50,000 users, because a single file can run out of memory.
- **Some data is never exported.** User and admin events, persisted sessions, workflow state and revoked tokens stay behind. Everyone will sign in again on the new system unless you plan otherwise.

## Step 3: Check which password hashes you have

Keycloak's default hashing algorithm has changed twice in recent releases:

| Keycloak version | Default algorithm (non-FIPS) | Default iterations |
|---|---|---|
| 20 to 23 | `pbkdf2-sha256` | 27,500 |
| 24 | `pbkdf2-sha512` | 210,000 |
| 25 and later | `argon2` (Argon2id) | 5 |

According to the [upgrading guide](https://www.keycloak.org/docs/latest/upgrading/index.html), a user's password is re-hashed with the new defaults only when they next sign in with a password. Anyone who hasn't signed in since an upgrade still has the old hash. A realm password policy that sets `hashAlgorithm` or `hashIterations` also overrides these defaults, and FIPS deployments don't use Argon2.

So a realm that has been running since Keycloak 20 can easily hold all three formats. Older realms may hold other formats too. In the export, each password sits in the user's `credentials` array. The salt and hash are in `secretData`, and the algorithm and its settings are in `credentialData`, both stored as JSON strings:

```json
{
  "type": "password",
  "secretData": "{\"value\":\"<base64 hash>\",\"salt\":\"<base64 salt>\",\"additionalParameters\":{}}",
  "credentialData": "{\"hashIterations\":5,\"algorithm\":\"argon2\",\"additionalParameters\":{\"hashLength\":[\"32\"],\"memory\":[\"7168\"],\"type\":[\"id\"],\"version\":[\"1.3\"],\"parallelism\":[\"1\"]}}"
}
```

Count what you actually have before you choose a target or a plan:

```bash
jq -r '.users[].credentials[]?
       | select(.type == "password")
       | .credentialData | fromjson | .algorithm' \
  /tmp/kc-export/myrealm-users-*.json | sort | uniq -c
```

Then compare the output with your user count. Users with no password credential either sign in through an identity provider, live in LDAP, or never set a password.

You have three options for passwords:

1. **Import the hashes.** The new system verifies the old hash at sign-in. Users keep their passwords. This needs a target that supports every algorithm and parameter set in your count.
2. **Verify on first sign-in.** The new system checks the password against Keycloak the first time a user signs in, then stores its own hash. This keeps Keycloak running until most active users have moved, and you still need a plan for the ones who never return.
3. **Force a reset.** Simple to build, but you will see support tickets and some users will not come back.

## Step 4: Move OIDC and SAML clients

Both OIDC and SAML are standards, so most apps only need configuration changes. Check each of these:

- **Issuer and discovery URL.** Keycloak's issuer is `https://<host>/realms/<realm>`. Apps that hard-code it, or that validate the `iss` claim against it, need the new value.
- **Signing keys.** New tokens are signed with new keys. Libraries that read the JWKS URL from discovery pick these up. Apps that pinned a public key don't.
- **Redirect URIs and client secrets.** Recreate each client with the same redirect URIs. Decide whether to keep client IDs and secrets or issue new ones, and rotate the old secrets afterwards.
- **Claims.** Keycloak puts roles in `realm_access.roles` and `resource_access.<client>.roles`. Any API that reads those paths will break unless the new system emits the same shape. Search your codebases for `realm_access` before cut-over day.
- **SAML service providers.** Partners use your IdP metadata from `/realms/<realm>/protocol/saml/descriptor`. Send them the new metadata and signing certificate early, because many need a change request on their side.
- **Upstream identity providers.** Social and enterprise IdPs only redirect to registered callback URLs. Add the new system's callback URLs in Google, Entra ID and the rest before you switch.

Users who signed in through an identity provider are linked to it in the export's `federatedIdentities` field. Keep those links when you import, or users will get a duplicate account the first time they sign in.

## Step 5: Choose a cut-over strategy

There are two common approaches.

**Big bang.** Import every user, switch every client in one maintenance window, and turn Keycloak off for logins.

- Works well with a handful of apps and one or two realms.
- One export, one import, one change window.
- Everyone signs in again once, because sessions don't move.

**Phased.** Move one app, one realm or one group of users at a time.

- Suits large estates and apps owned by different teams.
- Each step is small and easy to roll back.
- You run two systems for weeks or months, and you need to stop users changing passwords in the old one after they've been copied, or sync those changes.

Whichever you choose, freeze configuration changes in Keycloak during the move. A new client created on the day of the export is a client you will miss.

## Step 6: Test, then plan the rollback

Run a full rehearsal against a copy of production before the real thing:

- [ ] Export and import a recent copy of every realm.
- [ ] Sign in as a test user from each hash algorithm in your count.
- [ ] Sign in through each upstream identity provider.
- [ ] Test MFA enrolment and sign-in, password reset and account recovery.
- [ ] Call each API with a token from the new system and check the claims it reads.
- [ ] Complete a SAML sign-in with each service provider, or with their test environment.
- [ ] Time the export and import, so you know how long the window needs to be.

For rollback, keep it boring. Leave Keycloak and its database untouched and stopped, rather than deleted, for an agreed period. Keep the old client configuration so you can switch apps back by changing settings. Write down which event triggers a rollback and who decides, so nobody debates it at 2 a.m. Bear in mind that accounts created or changed on the new system after cut-over won't exist in Keycloak if you go back.

## Moving to Authgear

If you're moving to [Authgear](/compare/keycloak-alternative/), your Keycloak users keep their passwords. We migrate them with a database import that covers Keycloak's Argon2 and PBKDF2 hashes, so the mix of formats in an older realm is not a problem. Users who sign in with Google or another identity provider keep those links too. Our team helps with planning, the import and the switch-over.

The rest of the plan above still applies:

- Authgear is an OIDC provider and can act as a SAML identity provider, so clients move by configuration.
- You customise the login pages with CSS and HTML.
- Authgear's docs describe a [zero-downtime migration](https://docs.authgear.com/migration/zero-downtime-migration) for apps where users should stay signed in through the move.
- It's open source under Apache-2.0. You can self-host it with every feature, or we run a private cloud for you in the region you choose, including the UK and the EU. See [data sovereignty](/solutions/data-sovereignty/) for how that works.

To try it before you plan anything, [run Authgear locally in 10 minutes](/post/self-hosted-authentication-docker-kubernetes/) with Docker Compose. Production runs on Kubernetes with the Helm chart.

If you're working out where your login system should run and how to leave Keycloak, [book a 30-minute sovereignty review](/schedule-demo?topic=sovereignty-review).

## Frequently Asked Questions

### Can I export Keycloak users with their passwords?

Yes, with the kc.sh export command run against a stopped server. It writes users and their stored password hashes to JSON. The partial export in the Admin Console does not include users and masks secrets, so it is no use for a migration.

### What password hashing does Keycloak use?

Argon2 by default since Keycloak 25, outside FIPS mode. Keycloak 24 used PBKDF2-SHA512, and Keycloak 20 to 23 used PBKDF2-SHA256. A user's hash is only updated when they next sign in with a password, so most realms hold a mix.

### Will users have to reset their passwords when we leave Keycloak?

Only if the new system cannot verify their existing hashes. Count the hash algorithms in your export first, then check that your target supports each one.

### Should we migrate everyone at once or in phases?

A big bang cut-over is simpler when you have a few apps and can accept a short maintenance window. A phased migration, one app or user group at a time, suits larger estates but means running both systems for longer.
