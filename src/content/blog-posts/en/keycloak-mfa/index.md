---
title: "Keycloak MFA: OTP, WebAuthn and Conditional Flows (26.x)"
excerpt: "How to set up MFA in Keycloak 26: the OTP policy, required actions, WebAuthn as a second factor, passkeys, recovery codes, and conditional flows that ask only some users for a second factor."
coverImage: ./cover.webp
publishedAt: 2026-11-15
metaTitle: "Keycloak MFA: OTP, WebAuthn and Conditional 2FA Setup"
metaDescription: "Set up Keycloak MFA in 26.x: OTP policy, required actions, WebAuthn and passkeys, recovery codes, and a conditional flow that forces 2FA for admins only."
category: engineering
readTime: 10
faq:
  - q: "Does Keycloak have MFA built in?"
    a: "Yes. Keycloak supports OTP from authenticator apps, WebAuthn security keys and passkeys, and recovery codes. The default browser flow already contains a conditional 2FA sub-flow that asks for OTP from any user who has set it up."
  - q: "How do I force every user to set up OTP in Keycloak?"
    a: "Go to Authentication, Required actions and set Configure OTP as a default action. That covers new users only. For existing users, add Configure OTP to each user's required actions, or change the browser flow so a user with no second factor must set up OTP before they can finish signing in."
  - q: "Why does my Keycloak realm not have the Browser - Conditional 2FA sub-flow?"
    a: "Keycloak 26.3 renamed Browser - Conditional OTP to Browser - Conditional 2FA and added WebAuthn and recovery codes to it, but only for new realms. Realms created before 26.3 keep the old flow after an upgrade, so you add the WebAuthn Authenticator and Recovery Authentication Code Form executions yourself."
  - q: "Can I require MFA only for admins in Keycloak?"
    a: "Yes. Duplicate the browser flow and add a conditional sub-flow that uses Condition - user role. Inside it, set the OTP Form or WebAuthn Authenticator to Required, then bind the new flow as the realm's browser flow."
  - q: "Do passkey users still get asked for OTP in Keycloak?"
    a: "Not in the default browser flow of realms created on Keycloak 26.4 or later. The Condition - credential step skips the 2FA sub-flow when the user has already signed in with a passkey. Disable that condition if you want 2FA every time."
---

> **tl;dr:** Keycloak MFA is built from three parts: a **policy** (how OTP and WebAuthn behave), **required actions** (when users enrol), and the **browser authentication flow** (when users are asked for a second factor). The default flow asks for 2FA only from users who have set one up.

Keycloak has all the multi-factor authentication (MFA) pieces you need. They live in three places in the admin console, and the defaults changed during the 26.x releases. This guide walks through each part with the menu paths for the current version.

Everything here is checked against the Keycloak 26.8 documentation. Keycloak 26.8.2 is the latest release in November 2026.

## How MFA works in Keycloak

Think of a Keycloak realm as a building with a security desk. The **policy** decides what kind of badges the desk accepts. **Required actions** are the forms a visitor must fill in before they get a badge. The **authentication flow** is the desk's checklist: who gets asked for what, and in which order.

Open **Authentication** and click the **browser** flow. In a realm created on Keycloak 26.4 or later, you'll see this inside the **forms** sub-flow:

- **Username Password Form**, set to Required
- **Browser - Conditional 2FA**, a Conditional sub-flow containing:
  - **Condition - user configured**: true when the user has a second factor set up
  - **Condition - credential**: skips 2FA if the user already signed in with a passkey
  - **OTP Form**, Alternative
  - **WebAuthn Authenticator**, Disabled
  - **Recovery Authentication Code Form**, Disabled

A Conditional sub-flow runs only when all its conditions are true. So out of the box, a user who has set up OTP is asked for a code, and a user who hasn't is let straight in. That is "optional MFA".

> ⚠️ **Upgraded realms look different.** Before 26.3 this sub-flow was called **Browser - Conditional OTP** and held only the OTP Form. **Condition - credential** arrived in 26.4 with passkey support, so a realm created on 26.3 has the new sub-flow without it. Keycloak's upgrading guide says existing realms are not changed when you upgrade. If your realm is older, you'll need to add the WebAuthn and recovery code executions yourself. Our [Keycloak upgrade guide](/post/keycloak-upgrade-guide/) covers what else to check across versions.

## Step 1: Set the OTP policy

Go to **Authentication**, open the **Policies** tab, then **OTP Policy**. Keycloak uses these settings to build the QR code that users scan with an authenticator app such as FreeOTP or Google Authenticator.

| Setting | Default | What it does |
|---|---|---|
| OTP type | Time-based (TOTP) | TOTP changes every period. Counter-based (HOTP) changes after each use. |
| OTP hash algorithm | SHA1 | SHA256 and SHA512 are also available. |
| Number of digits | 6 | Longer codes are harder to guess and harder to type. |
| Look around window | 1 | Accepts one period either side, so a 30-second code works for 90 seconds. |
| OTP token period | 30 seconds | How long each TOTP code lasts. |
| Reusable token | Off | When off, a code can't be used twice. |

The defaults are sensible. Change the algorithm or digit count only after checking that your users' authenticator apps support the new settings. If TOTP itself is new to you, our [TOTP explainer](/post/what-is-totp/) covers how the codes are made.

If you keep realm settings in scripts, the same values are fields on the realm that you can set with the Admin CLI:

```bash
kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin

kcadm.sh update realms/myrealm \
  -s otpPolicyType=totp \
  -s otpPolicyAlgorithm=HmacSHA1 \
  -s otpPolicyDigits=6 \
  -s otpPolicyPeriod=30 \
  -s otpPolicyLookAheadWindow=1 \
  -s otpPolicyCodeReusable=false
```

## Step 2: Decide who must enrol

You have three choices, from gentlest to strictest.

### Optional: users opt in

Leave the default flow as it is. Users set up OTP themselves in the Account Console under **Account security**, then **Signing in**, then **Set up Authenticator application**. From then on they're asked for a code at every login.

### New users must enrol

Go to **Authentication**, then **Required actions**. Turn on **Configure OTP** and set it as a **default action**. Every new user must set up OTP on their first login.

This applies only to users created after you make the change. For existing users, open **Users**, pick a user and add **Configure OTP** under **Required user actions**. For many users, script it:

```bash
kcadm.sh update users/<user-id> -r myrealm \
  -s 'requiredActions=["CONFIGURE_TOTP"]'
```

That command replaces the user's whole required actions list, so include any actions they already have.

### Everyone must use 2FA, enforced by the flow

Required actions only fire once. To make sure nobody signs in without a second factor, change the flow. Keycloak's docs give a pattern for this, called "Conditional 2FA sub-flow with OTP default":

1. In **Authentication**, open the action menu (three dots) on the **browser** flow and choose **Duplicate**. Name it `browser-mfa`.
2. Inside the copy's forms sub-flow, keep the conditional 2FA sub-flow as it is.
3. Add a second sub-flow after it, set to **Conditional**. Add **Condition - sub-flow executed** to it. For **Flow name**, enter the copied 2FA sub-flow's name. Duplicating a flow puts the new flow's name in front of each sub-flow, so here it is `browser-mfa Browser - Conditional 2FA`. Set **Check result** to `not-executed`.
4. In the same sub-flow, add **OTP Form** and set it to **Required**.
5. From the action menu, choose **Bind flow** and select **Browser flow**.

Now a user with a second factor uses it as normal. A user with none is made to set up OTP before the login finishes.

There's a catch for passkey users. After a passkey sign-in, the 2FA sub-flow is skipped, so the new sub-flow sees it as not executed and asks for OTP anyway. To keep the passkey skip, add a **Condition - credential** to the new sub-flow as well. Set **Credentials** to `webauthn-passwordless`, the passkey credential, and turn **Included** off. The condition is then true only when no passkey was used.

A simpler shortcut is to set **Browser - Conditional 2FA** to Required, and the **OTP Form** inside it to Required too. If OTP Form stays on Alternative, a user with no second factor can't sign in at all, instead of being asked to set up OTP. Conditions only count inside a Conditional sub-flow, so the ones inside it are then ignored, including the passkey skip.

## Step 3: Add WebAuthn and passkeys

WebAuthn lets users approve a login with a security key, such as a YubiKey, or with the device's own biometrics. It resists phishing far better than a six-digit code, because the credential only works on the site it was registered for.

To offer WebAuthn as a second factor:

1. **Authentication**, then **Required actions**: check **Webauthn Register** is turned on.
2. **Authentication**, then **Policies**, then **WebAuthn Policy**: review the settings. The **Relying Party ID** defaults to the host of Keycloak's URL, which is right for most set-ups. Since 26.7 a **Discoverable credential** setting (required, preferred or discouraged) replaces the older yes/no option.
3. Open your browser flow and set **WebAuthn Authenticator** inside the 2FA sub-flow from **Disabled** to **Alternative**.

Users who register both OTP and WebAuthn see their highest-priority method first, with a **Try Another Way** link to switch. To make WebAuthn the only second factor, set OTP Form to Disabled.

### Passkeys as the first factor

Passkeys go one step further and replace the password. In Keycloak they're the passwordless variant of WebAuthn, with their own **WebAuthn Passwordless Policy** and **Webauthn Register Passwordless** required action. Passkeys became a supported feature in Keycloak 26.4. In 26.8 you switch them on under **Realm settings**, **Login** tab, **Enable Passkeys**. It's off in a new realm.

Here's the MFA catch. A passkey proves you have the device and that you unlocked it with a PIN or fingerprint. So the default flow's **Condition - credential** step skips 2FA when a user signs in with a passkey. If your security policy needs a separate second factor every time, set that condition to Disabled.

For a deeper look at passkeys in your own apps, see our [developer guide to passkeys](/post/how-to-implement-passkeys-developer-guide/).

## Step 4: Turn on recovery codes

People lose phones. Without a fallback, every lost phone becomes a support ticket and a manual reset. Recovery codes became a supported Keycloak feature in 26.3.

1. **Authentication**, then **Required actions**: check **Recovery Authentication Codes** is enabled. You can set a **Warning Threshold**, so the Account Console warns users when they are running low.
2. In the browser flow, set **Recovery Authentication Code Form** from **Disabled** to **Alternative**.
3. Optional: open the **Configure OTP** required action's settings and turn on **Add Recovery Codes**. Users who set up OTP are then asked to save recovery codes straight away.

Keycloak generates 12 codes and asks for them in order. Each one works once. Users must tick a box confirming they have saved the codes before they can carry on.

## Conditional MFA: only for some users

Many teams want 2FA for admins and staff, and optional 2FA for everyone else. Keycloak's **Condition - user role** handles this.

1. Duplicate the browser flow, as in Step 2.
2. In the forms sub-flow, after the 2FA sub-flow, add a sub-flow called `Admin 2FA` and set it to **Conditional**.
3. Add **Condition - user role** and pick the role, for example `admin` or `myapp.admin` for a client role.
4. Add **Condition - sub-flow executed**. Point it at the copied 2FA sub-flow by its full name, for example `browser-mfa Browser - Conditional 2FA`, with **Check result** `not-executed`. Without it, admins who already use 2FA are asked twice.
5. Add **Condition - credential** for passkeys with **Included** off, as in Step 2, if admins who sign in with a passkey should skip this step.
6. Add **OTP Form** (or **WebAuthn Authenticator**) and set it to **Required**.
7. Bind the flow as the browser flow.

Other useful conditions include **Condition - user attribute** and **Condition - client scope**, which asks for 2FA only when an app requests a particular scope. A **Deny access** step inside a conditional sub-flow blocks a login with your own error message.

For "step-up" authentication, where an app asks for a stronger login only for sensitive actions, Keycloak uses conditional sub-flows with **Condition - Level of Authentication**. The app requests a level with the `acr_values` or `claims` parameter. It's a bigger topic, so start from the step-up section of the Keycloak Server Administration Guide.

## Test it before your users do

Keycloak's docs recommend testing corner cases to make sure a flow has no security holes. Test with real accounts:

- **A brand-new user**, a user with OTP, a user with WebAuthn, a user who signs in with a passkey and a user with nothing set up. Each should get the experience you expect.
- **A user whose credentials you deleted.** If a second factor is Required and the user has none, Keycloak lets them set it up during that login. That's fine after a password, but a flow with no first factor would let anyone in.
- **Forgot password.** The **Reset Credentials** flow has its own **Reset - Conditional OTP** sub-flow. By default, a user who resets their password is asked to set up their OTP generator again.
- **Direct grant.** Browser flow changes don't apply to the **Direct Grant** flow. If a client has direct access grants turned on, that flow checks only OTP, through its own **Direct Grant - Conditional OTP** sub-flow.
- **Clocks.** TOTP codes depend on time. Keep NTP running on the Keycloak hosts.

Export the realm once it works, so you can rebuild the same flow in every environment.

## How Authgear handles MFA

If you're comparing options, here's how [Authgear](/compare/keycloak-alternative/), an open-source authentication platform from a UK company, approaches the same job.

For the common cases you don't need to build a flow. In the portal, under **Authentication**, then **2FA**, you pick a policy:

- **Disabled**: nobody is asked for 2FA.
- **Optional**: only users who have set up 2FA are asked for it.
- **Mandatory**: every user must use 2FA, with an optional global grace period so users without 2FA set it up at their next login. You can also give a single user a 10-day grace period.

Second factors include an authenticator app, an email code or link, a code by SMS or WhatsApp, an additional password and recovery codes. A "Do not ask again on this device" option lets users skip 2FA on a trusted device. Passkeys can be the main way to sign in.

For conditional MFA, such as 2FA for admins only, a blocking hook can return a `constraints` object that requires MFA for that login:

```json
{
  "is_allowed": true,
  "constraints": {
    "amr": ["mfa"]
  }
}
```

You can self-host Authgear on your own infrastructure, or we run it for you as a private cloud in the region you choose. If you're moving from Keycloak, you can import Keycloak users with their passwords.

Want to see it running? [Try Authgear locally in 10 minutes](/post/self-hosted-authentication-docker-kubernetes/) with Docker Compose, then read how production runs on Kubernetes with Helm.

## Frequently Asked Questions

### Does Keycloak have MFA built in?

Yes. Keycloak supports OTP from authenticator apps, WebAuthn security keys and passkeys, and recovery codes. The default browser flow already contains a conditional 2FA sub-flow that asks for OTP from any user who has set it up.

### How do I force every user to set up OTP in Keycloak?

Go to Authentication, Required actions and set Configure OTP as a default action. That covers new users only. For existing users, add Configure OTP to each user's required actions, or change the browser flow so a user with no second factor must set up OTP before they can finish signing in.

### Why does my Keycloak realm not have the Browser - Conditional 2FA sub-flow?

Keycloak 26.3 renamed Browser - Conditional OTP to Browser - Conditional 2FA and added WebAuthn and recovery codes to it, but only for new realms. Realms created before 26.3 keep the old flow after an upgrade, so you add the WebAuthn Authenticator and Recovery Authentication Code Form executions yourself.

### Can I require MFA only for admins in Keycloak?

Yes. Duplicate the browser flow and add a conditional sub-flow that uses Condition - user role. Inside it, set the OTP Form or WebAuthn Authenticator to Required, then bind the new flow as the realm's browser flow.

### Do passkey users still get asked for OTP in Keycloak?

Not in the default browser flow of realms created on Keycloak 26.4 or later. The Condition - credential step skips the 2FA sub-flow when the user has already signed in with a passkey. Disable that condition if you want 2FA every time.

## Further reading

- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html): OTP policies, WebAuthn, passkeys, recovery codes and conditional flows
- [Keycloak upgrading guide](https://www.keycloak.org/docs/latest/upgrading/index.html)
- [Keycloak custom login page](/post/keycloak-custom-login-page/): themes for the pages your MFA prompts appear on
- [What is multi-factor authentication?](/post/what-is-multi-factor-authentication-mfa/)
- [Authgear docs: Enable two-factor authentication](https://docs.authgear.com/authentication-and-access/authentication/enable-two-factor-authentication-2fa)
