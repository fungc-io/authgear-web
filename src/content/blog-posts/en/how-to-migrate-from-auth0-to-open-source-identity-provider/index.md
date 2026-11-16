---
title: "How to Migrate From Auth0 to an Open-Source Identity Provider"
excerpt: "A practical Auth0 migration plan: export the tenant and its users, get your password hashes and TOTP secrets out through Auth0 support, move applications and social logins, and choose a cut-over that keeps users signed in."
coverImage: ./cover.webp
category: highlight
featured: true
metaTitle: "Migrate From Auth0 to an Open-Source IdP: A Practical Guide"
metaDescription: "Migrate off Auth0: export tenant config and users, get password hashes and MFA secrets from Auth0 support, move apps and social logins, plan the cut-over."
publishedAt: 2025-12-16T17:40:16.768Z
updatedAt: 2026-11-16
readTime: 10
draft: false
faq:
  - q: "Can I export password hashes from Auth0?"
    a: "Not through the dashboard or the Management API. You open a support case, supply a PGP key, have a second tenant administrator confirm the request, and get a CISO or VP-level signature on Auth0's acknowledgment form. Auth0 reviews each request, says not all of them qualify, and gives no turnaround time."
  - q: "What password hashing does Auth0 use?"
    a: "bcrypt. Auth0 states that it hashes and salts every database-connection password with bcrypt, so a target that verifies bcrypt hashes can accept them as they are."
  - q: "Will users have to reset their passwords when we leave Auth0?"
    a: "Only if Auth0 declines the hash export, or your new provider cannot verify bcrypt. If the export is refused, you can check each returning user's password against Auth0 on their first sign-in and store a fresh hash, then fall back to a reset for users who never return."
  - q: "Can MFA settings move with the users?"
    a: "TOTP secrets can, as part of the same support export as the password hashes. Push notifications through the Guardian app, WebAuthn credentials and SMS enrolments cannot, so those users enrol again on the new system."
  - q: "How do I roll back if the migration goes wrong?"
    a: "Keep the Auth0 tenant on its current plan until the new system has run clean for a few weeks, freeze profile and password changes during the cut-over, and keep the old client IDs and callback URLs registered so you can repoint the apps. Auth0 has no read-only mode, so the freeze is yours to enforce."
---

> **tl;dr:** To leave Auth0 without resetting passwords, export the tenant with the Deploy CLI, export users with the Management API, and open a support case for the password hashes and TOTP secrets, which Auth0 only releases on request. Rebuild the logic in Actions, repoint applications and social connections, then cut over in one go or keep users signed in with a session exchange. Keep the Auth0 tenant alive until you are sure.

Most Auth0 migrations go wrong on two details. The first is that the export you can run yourself does not include password hashes. The second is that the code in your Actions has quietly become part of your login, and nobody has written down what it does. Both are fixable, but only if you plan for them before you pick a date.

This guide is a plan you can follow whatever you move to. It's based on Auth0's documentation as of November 2026. If you are still choosing a target, our [comparison of open-source Auth0 alternatives](/post/top-open-source-auth0-alternatives/) covers Authgear, Keycloak, Ory and others.

## Why teams leave Auth0 now

Auth0 is easy to adopt, and most teams that leave it liked it for years. Four things tend to change that:

- **Price at scale.** Auth0 charges by monthly active users, and the features a growing product needs tend to sit on higher plans. Above the self-service tiers, pricing is a negotiation.
- **Rules and Hooks reached end of life on 18 November 2026.** [Auth0's docs](https://auth0.com/docs/customize/rules) set that date, and tenants created after October 2023 never had the features. Any logic still in them has stopped running, and teams rewriting it as Actions are asking whether to rewrite it on Auth0 at all.
- **Data residency.** The login system holds every customer's email, phone number and sign-in history. Rules on where that data may live, and who may be compelled to hand it over, are tightening in the EU and the UK. A managed US provider is a harder sell than it was.
- **Control.** Universal Login, Actions and the Management API are Auth0's surface, not yours. An open-source provider lets you read the code, run it where you want and change what you need.

## Step 1: Export your tenant configuration

Before you export a single user, capture everything else. Auth0's [Deploy CLI](https://auth0.com/docs/deploy-monitor/deploy-cli-tool) writes the tenant's configuration to YAML. Create a machine-to-machine application with read scopes on the Management API, then:

```bash
npm install -g auth0-deploy-cli

export AUTH0_DOMAIN=your-tenant.eu.auth0.com
export AUTH0_CLIENT_ID=...
export AUTH0_CLIENT_SECRET=...

a0deploy export --format=yaml --output_folder=./auth0-tenant
```

The output covers applications with their callback URLs and grant types, connections, Actions, roles and permissions, branding, email templates and more. Three parts of it decide how much work the migration is:

- **Applications.** Each one is an OIDC client you will recreate. Note the type (regular web, single-page, native or machine-to-machine), the callback and logout URLs, and which APIs it calls.
- **Connections.** Database connections hold your users. Social connections (Google, Apple, GitHub) and enterprise connections (SAML, OIDC, Entra ID, Google Workspace) point at other people's identity providers and move by configuration.
- **Actions.** This is custom code that runs during login: adding claims, blocking sign-ups from certain domains, calling your CRM, enforcing MFA for admins. Read every one and write down what it does in plain language. Some of it maps to a setting in the new provider, some needs a webhook, and some you will find is no longer needed.

The export also lists your APIs (resource servers) and their scopes, which your backend code checks for. Keep that list for Step 5.

## Step 2: Export users

The user export runs as a job on the [Management API](https://auth0.com/docs/manage-users/user-migration/bulk-user-exports), or from the dashboard under User Management, Users, Import/Export Users. It is not available on the Free plan. Ask for JSON, not CSV: CSV is capped at 30 fields and cannot include `app_metadata` or `user_metadata` as whole objects.

```bash
curl -X POST "https://$AUTH0_DOMAIN/api/v2/jobs/users-exports" \
  -H "Authorization: Bearer $MGMT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "fields": [
      {"name": "user_id"}, {"name": "email"}, {"name": "email_verified"},
      {"name": "username"}, {"name": "phone_number"}, {"name": "name"},
      {"name": "given_name"}, {"name": "family_name"}, {"name": "picture"},
      {"name": "identities"}, {"name": "app_metadata"}, {"name": "user_metadata"},
      {"name": "blocked"}, {"name": "created_at"}, {"name": "last_login"}
    ]
  }'
```

Leave out `connection_id` to export every connection at once. Poll `GET /api/v2/jobs/{job_id}` until the status is `completed`, then fetch the file from the `location` URL. The link is valid for 60 seconds, and the job and its file are deleted after 24 hours, so script the download.

The file is gzipped newline-delimited JSON, one user per line. Before you plan anything, count what kind of users you have:

```bash
gunzip -c users.json.gz | jq -r '.identities[0].provider' | sort | uniq -c
```

Users whose provider is `auth0` have a password in a database connection. Everyone else (`google-oauth2`, `apple`, `samlp`, `waad` and so on) signs in through another provider and has no password to migrate. The split tells you how many people the password question in Step 3 affects.

Two things the export does not contain:

- **Roles.** Auth0's RBAC roles live on the role, not the user. List them with `GET /api/v2/roles`, then page through `GET /api/v2/roles/{id}/users` for each one.
- **Password hashes.** Those need Step 3.

Keep the `user_id` for every user. Your own database almost certainly stores it, as `auth0|5f1e...` or `google-oauth2|1098...`, and the new provider will issue a different `sub`. You either import the old ID as a custom attribute and look it up at sign-in, or run a one-off script that rewrites your foreign keys after the import.

## Step 3: Get your password hashes, and plan for not getting them

Auth0 hashes database-connection passwords with [bcrypt](https://auth0.com/blog/hashing-in-action-understanding-bcrypt/). A bcrypt hash can be verified by any system that implements bcrypt, so in principle your users keep their passwords. In practice, getting the hashes out is a process, not an API call.

Auth0 only releases hashes through a [support case](https://auth0.com/docs/manage-users/user-migration/export-password-hashes-and-mfa-secrets). The documented requirements, as of November 2026:

- The request names the tenant and includes a PGP public key: RSA, with a 4096-bit encryption subkey, valid for at least seven days.
- A second tenant administrator confirms the request, unless there is only one.
- A CISO, CSO or VP-level executive signs Auth0's Hashed Password and MFA Secret Export Acknowledgment form. Typed names are not accepted.
- Auth0 reviews eligibility first. The docs say "not all requests qualify for an export", and give no turnaround time.
- The file is delivered PGP-encrypted through a link that only the case creator can open, valid for three days.

Open the case early, before you have told users anything, because the answer changes your plan. You have three options, in order of preference:

| Option | Users keep passwords? | Needs | Cost |
|---|---|---|---|
| **Import the hashes** | Yes | Auth0 approves the export; the target verifies bcrypt | A support case and some patience |
| **Verify on first sign-in** | Yes, for users who return | Auth0 stays live; a small service that checks the password against Auth0 and stores a new hash | Two systems running for weeks; a plan for users who never come back |
| **Force a reset** | No | A password reset email to everyone | Support tickets, and some users will not come back |

The second option works because Auth0's Resource Owner Password grant lets a backend check a password against a database connection. It is a stopgap, not a destination. Set a deadline, then reset whoever is left.

## Step 4: Decide what happens to MFA

The same support export can include MFA secrets, which in practice means TOTP seeds for users who enrolled an authenticator app. Those import cleanly into a provider that accepts TOTP secrets.

Nothing else moves:

- **Push notifications** through the Auth0 Guardian app are tied to Auth0.
- **WebAuthn and passkeys** are bound to Auth0's domain, and the public keys stay in Auth0's store.
- **SMS and email codes** have no secret to export. Re-enrolment is just confirming the phone number again.

So the plan for MFA is a list of who enrolled what (`GET /api/v2/users/{id}/authentication-methods` tells you per user), a cut-over message that explains the one-time re-enrolment, and a grace period before you enforce MFA again on the new system. If an Action enforces MFA for a group, such as admins, that policy moves in Step 5.

## Step 5: Move applications and backend token checks

Every Auth0 application becomes a client in the new provider. The grant types map directly: regular web apps use the authorization code flow, SPAs and native apps use authorization code with PKCE, and machine-to-machine apps use client credentials. Copy the callback URLs and logout URLs from the Step 1 export.

Universal Login is the part most teams underestimate. Auth0 renders the login page for you, and any branding, custom text or page templates you added sit inside Auth0. The new provider renders its own pages, so expect to redo the branding once. If you built a custom login UI against Auth0's authentication API, that is a bigger rewrite, and a good moment to switch to hosted pages.

Your backends check Auth0's access tokens today. Each one needs its issuer, keys and audience changed:

| Check | Auth0 | After migration |
|---|---|---|
| Issuer (`iss`) | `https://your-tenant.eu.auth0.com/` (trailing slash) | The new provider's endpoint, read from its OpenID discovery document |
| Keys | `https://your-tenant.eu.auth0.com/.well-known/jwks.json` | The `jwks_uri` in `/.well-known/openid-configuration` |
| Audience (`aud`) | The API identifier you registered | Whatever the new provider puts there; check its docs |
| Subject (`sub`) | `auth0\|...` or `google-oauth2\|...` | A new ID per user, see Step 2 |
| Permissions | The `permissions` array, or namespaced claims added by an Action | The new provider's roles claim, or a lookup in your own database |

Ship the backend change behind a flag that accepts both issuers for the cut-over window. That is what lets you move apps one at a time without a big-bang deploy of every service.

Finally, go back to the Actions you catalogued in Step 1 and place each one: a built-in setting, a webhook on the new provider, a change in your own app, or deletion.

## Step 6: Move social and enterprise connections

Social connections are the easy part, as long as you keep the same OAuth app on each provider. Users are identified by the provider's stable subject, so the Google user who signed into Auth0 is the same Google user when they sign into the new system. Do not create a new Google or Apple app. Add the new provider's callback URL to the existing one, and remove Auth0's URL after the cut-over.

Two things to check:

- **Account linking.** The imported user has an email address. The first time they sign in with Google on the new system, the provider has to attach that Google identity to the existing account rather than create a duplicate. Make sure your target supports linking by verified email, and decide whether to ask the user to confirm with their password once. That confirmation is what stops an attacker who controls an unverified email on some provider from taking over an account.
- **Sign in with Apple.** Apple's private relay emails only deliver to domains you have registered with Apple for that team. Keep the same Apple developer team and Services ID, and register the new provider's sending domain, or relay users will miss every email you send.

Enterprise connections (SAML and OIDC to a customer's Entra ID, Okta or Google Workspace) each have a counterpart on the customer's side who has to add a new service provider or client. That is the part of the plan with the longest lead time. Start those conversations as soon as you have the new provider's metadata URL, and keep the Auth0 connection live until each customer confirms.

## Step 7: Choose a cut-over and keep a rollback

There are three ways to switch, and the right one depends on how much a forced sign-out costs you.

1. **Big bang.** Freeze password and profile changes on Auth0, run the final export and import, deploy the apps pointing at the new provider, and everyone signs in again. Simplest, and fine for internal tools or a single app with a maintenance window.
2. **Keep users signed in.** Import users as above, then have your app accept both an Auth0 session and a new-provider session for a while. When a request arrives with a valid Auth0 token, a small endpoint verifies it and mints a session on the new provider for the same user. Users notice nothing. This is the path to take for a consumer app where a sign-out means churn.
3. **Phased by application.** Move one application at a time, with the backend accepting both issuers (Step 5). Both providers run for the whole period, so profile changes on one do not reach the other. Use it when you have many apps and few users, or combine it with a change freeze.

Whichever you choose, keep a way back:

- **Keep the Auth0 tenant on its current plan** until the new system has been clean for a few weeks, and do not cancel before the hash export has arrived.
- **Freeze profile and password changes** before the final export. Auth0 has no read-only switch, so turn off sign-ups on the database connection, disable password-change flows in your app, and pause Actions that write to user metadata.
- **Keep the old client IDs and callback URLs** registered, so repointing an app back is a config change.
- **Watch four numbers for the first week:** sign-in success rate, password reset volume, support tickets that say "can't log in", and MFA enrolment. Those tell you whether the import and the hash verification worked.

## Moving to Authgear

If you are moving to [Authgear](/compare/auth0-alternative/), the steps above map onto a few concrete pieces.

**Users import with their bcrypt hashes.** The [User Import API](https://docs.authgear.com/reference/apis/user-import-api) accepts each user's bcrypt hash, TOTP secret, roles, groups, custom attributes and disabled flag in one record. Reformat the Auth0 export into its schema and post it in batches:

```json
{
  "identifier": "email",
  "records": [
    {
      "email": "alice@example.com",
      "email_verified": true,
      "name": "Alice Lee",
      "password": { "type": "bcrypt", "password_hash": "$2b$10$..." },
      "mfa": { "totp": { "secret": "JBSWY3DPEHPK3PXP" } },
      "roles": ["admin"],
      "custom_attributes": { "auth0_user_id": "auth0|5f1e4c2a9b..." },
      "disabled": false
    }
  ]
}
```

Declare `auth0_user_id` as a custom attribute in the Portal first, and your backend can look users up by their old ID during the transition. The import runs as a job with a per-record outcome, so a bad row does not fail the batch. Send `upsert: true` on a second run to apply profile changes that happened between your first export and the freeze.

**Sessions can carry over.** Authgear's [zero-downtime migration](https://docs.authgear.com/migration/zero-downtime-migration) is the "keep users signed in" option from Step 7 as a documented procedure: your app verifies the Auth0 token, calls the Admin API's `createSession` for the matching Authgear user, and hands back an Authgear session. If a sign-out is acceptable, the [bulk migration](https://docs.authgear.com/admin-and-operations/migration/bulk-migration) guide is shorter.

**Social sign-ins attach to imported users.** Add `https://<your-authgear-endpoint>/sso/oauth2/callback/google` to the same Google OAuth client Auth0 uses, then configure [account linking](https://docs.authgear.com/authentication-and-access/social-enterprise-login-providers/account-linking) with `action: login_and_link`, so a Google sign-in whose email matches an imported user joins that account after a one-time confirmation.

**Backends switch by configuration.** Turn on "Issue JWT as access token" for each application, point your middleware at the `jwks_uri` from Authgear's discovery document, and read roles from the `https://authgear.com/claims/user/roles` claim in place of Auth0's `permissions`. See [verifying JWTs in your backend](https://docs.authgear.com/get-started/backend-api/jwt).

Beyond the mechanics:

- Authgear is an OIDC provider and can act as a SAML identity provider, so enterprise connections and your own apps move by configuration.
- You customise the login pages with your own CSS and HTML, which is where the Universal Login branding goes.
- It's open source under Apache-2.0. You can self-host it with every feature, or we run a private cloud for you in the region you choose, including the UK and the EU. See [data sovereignty](/solutions/data-sovereignty/) for how that works.

To try it before you plan anything, [run Authgear locally in 10 minutes](/post/self-hosted-authentication-docker-kubernetes/) with Docker Compose. Our team helps with the Auth0 support case, the import and the switch-over. [Schedule a demo](/schedule-demo) and bring your tenant export; we'll walk through the plan with you.

## Frequently Asked Questions

### Can I export password hashes from Auth0?

Not through the dashboard or the Management API. You open a support case, supply a PGP key, have a second tenant administrator confirm the request, and get a CISO or VP-level signature on Auth0's acknowledgment form. Auth0 reviews each request, says not all of them qualify, and gives no turnaround time.

### What password hashing does Auth0 use?

bcrypt. Auth0 states that it hashes and salts every database-connection password with bcrypt, so a target that verifies bcrypt hashes can accept them as they are.

### Will users have to reset their passwords when we leave Auth0?

Only if Auth0 declines the hash export, or your new provider cannot verify bcrypt. If the export is refused, you can check each returning user's password against Auth0 on their first sign-in and store a fresh hash, then fall back to a reset for users who never return.

### Can MFA settings move with the users?

TOTP secrets can, as part of the same support export as the password hashes. Push notifications through the Guardian app, WebAuthn credentials and SMS enrolments cannot, so those users enrol again on the new system.

### How do I roll back if the migration goes wrong?

Keep the Auth0 tenant on its current plan until the new system has run clean for a few weeks, freeze profile and password changes during the cut-over, and keep the old client IDs and callback URLs registered so you can repoint the apps. Auth0 has no read-only mode, so the freeze is yours to enforce.
