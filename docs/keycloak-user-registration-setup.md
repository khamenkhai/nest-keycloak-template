# Keycloak setup for API user registration

This service registers users through the Keycloak Admin REST API, then immediately requests a token with the user's email and password. Configure the `SYSTEM_REALM` realm and the `api_client` client so Keycloak does not require an interactive browser setup before issuing that token.

> These instructions are for the Keycloak 26 container in `docker-compose.yaml`. Use a Keycloak administrator account to make the changes.

## 1. Select the realm

1. Open `http://localhost:8080` and sign in to the Keycloak Admin Console.
2. In the realm selector, select `SYSTEM_REALM`.

## 2. Disable email verification

1. Open **Realm settings**.
2. Open the **Login** tab.
3. Set **Verify email** to **Off**.
4. Click **Save**.

The registration code already creates users with `emailVerified: true`. Disabling realm-level verification prevents Keycloak from adding an email-verification required action for API-created accounts.

## 3. Remove required user-profile fields

Keycloak 26 uses the declarative **User profile** screen. It does not have a single global “disable user profile” switch; instead, make every field that your API does not supply optional.

1. Open **Realm settings** → **User profile**.
2. For every attribute your API does not create (for example `firstName`, `lastName`, `phoneNumber`, or custom attributes), edit the attribute and remove its **Required** validator/condition.
3. Save each change.
4. Ensure the default `username` and `email` attributes remain available, because this service supplies both.

Alternatively, update `src/modules/auth/auth.service.ts` to provide all fields that you deliberately make mandatory. Do not mark a field required unless the API sends it during registration.

## 4. Disable required actions for API-created users

1. Open **Authentication** → **Required actions**.
2. Disable actions that would force the user into a browser flow, unless your product intentionally uses them:
   - **Verify Email**
   - **Update Password**
   - **Configure OTP**
   - **Update Profile**
   - any custom required action

The service also writes `requiredActions: []` when it creates the user. The realm configuration must not impose additional required actions at login, otherwise the password-grant token request fails with `Account is not fully set up`.

## 5. Configure the client for service-account user creation

Open **Clients** → **api_client**.

### Capability configuration

1. Under **Capability config**, set **Client authentication** to **On**. This makes the client confidential and allows the `KEYCLOAK_CLIENT_SECRET` used by the service.
2. Set **Service accounts roles** / **Service account roles** to available by enabling **Service account roles** if your Keycloak screen shows this switch.
3. Enable **Direct access grants** because the service calls the token endpoint with `grant_type=password` right after registration.
4. Save the client.

### Assign service-account roles

1. Open the client’s **Service account roles** tab.
2. From **Client roles**, select `realm-management`.
3. Assign these minimum roles:
   - `manage-users` — create and update users
   - `view-users` — read users when needed
   - `query-users` — search users when needed

These are the recommended roles for this application.

### Full realm-management access (only if explicitly required)

To give this client all administration permissions in the `SYSTEM_REALM` realm, assign the `realm-management` client role **`realm-admin`** to the client’s service account.

`realm-admin` can manage users, clients, roles, groups, authentication, and other realm settings. Treat the client secret like an administrator password and do not use this role unless the service genuinely needs unrestricted realm administration.

## 6. Verify environment variables

The following values must match the configured client:

```env
KEYCLOAK_BASE_URL=http://localhost:8080
KEYCLOAK_REALM_NAME=SYSTEM_REALM
KEYCLOAK_CLIENT_ID=api_client
KEYCLOAK_CLIENT_SECRET=<client-secret-from-Keycloak>
KEYCLOAK_GRANT_TYPE=client_credentials
```

After changing the Keycloak client secret, update the local environment file and restart the Nest application.

## 7. Test

Register a brand-new email through `POST /api/v1/auth/register`. A successful request should:

1. Create an enabled Keycloak user with no required actions.
2. Create the corresponding database user.
3. Return access and refresh tokens.

If a failed registration already created the user in Keycloak and the database, do not retry with the same email until you either delete that test user from both systems or add recovery handling. Otherwise the next request correctly returns `409 Email already registered`.

## Security note

The password grant used here requires the backend to receive the user password. For public or browser/mobile clients, prefer Authorization Code Flow with PKCE. Keep `client_credentials` for the backend service account that administers Keycloak.
