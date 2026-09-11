# RBAC Documentation (Keycloak UMA)

## Overview

This project uses **Keycloak's User-Managed Access (UMA)** for resource-based authorization. Instead of simple role checks, each endpoint is protected by a combination of `@Resource` and `@Scopes` decorators. The `ResourceGuard` validates permissions against Keycloak at runtime via token introspection.

## Architecture

```
HTTP Request
  |
  v
UserMiddleware (cookie → Authorization header)
  |
  v
AuthGuard [GLOBAL] (validates JWT; skips if @Public)
  |
  v
ResourceGuard [GLOBAL] (checks @Resource + @Scopes via Keycloak UMA)
  |
  v
Controller handler
```

## Keycloak Configuration

| Setting             | Value          | File                       |
| ------------------- | -------------- | -------------------------- |
| `policyEnforcement` | `PERMISSIVE`   | `src/keycloak/keyclock.ts` |
| `tokenValidation`   | `ONLINE`       | `src/keycloak/keyclock.ts` |
| `realm`             | `SYSTEM_REALM` | `.env`                     |
| `clientId`          | `api_client`   | `.env`                     |

**Why PERMISSIVE?** In `ENFORCING` mode, the `ResourceGuard` denies routes without `@Resource`/`@Scopes` **before** checking `@Public()`. `PERMISSIVE` allows unannotated routes through while still protecting `@Resource` + `@Scopes` routes.

## Authorization Model

### Scopes

- `create` — Create new resources
- `read` — Read/list resources
- `update` — Update existing resources
- `delete` — Delete resources

### Resources

| Resource     | Decorator                 | Controller                                        |
| ------------ | ------------------------- | ------------------------------------------------- |
| `Posts`      | `@Resource('Posts')`      | `src/modules/posts/posts.controller.ts`           |
| `Categories` | `@Resource('Categories')` | `src/modules/categories/categories.controller.ts` |

### Policies (Group-Based)

| Policy               | Group   | Description      |
| -------------------- | ------- | ---------------- |
| `admin-group-policy` | `admin` | Full CRUD access |
| `user-group-policy`  | `user`  | Read-only access |

### Permission Matrix

| Resource   | Scope  | admin-group | user-group |
| ---------- | ------ | ----------- | ---------- |
| Posts      | create | ✅          | ❌         |
| Posts      | read   | ✅          | ✅         |
| Posts      | update | ✅          | ❌         |
| Posts      | delete | ✅          | ❌         |
| Categories | create | ✅          | ❌         |
| Categories | read   | ✅          | ✅         |
| Categories | update | ✅          | ❌         |
| Categories | delete | ✅          | ❌         |

## Route Protection

### Protected Routes (UMA)

```
@UseGuards(ResourceGuard) applied globally via APP_GUARD
```

| Route                           | Resource   | Scope  | Access       |
| ------------------------------- | ---------- | ------ | ------------ |
| `GET /api/v1/posts`             | Posts      | read   | admin + user |
| `GET /api/v1/posts/:id`         | Posts      | read   | admin + user |
| `POST /api/v1/posts`            | Posts      | create | admin only   |
| `PATCH /api/v1/posts/:id`       | Posts      | update | admin only   |
| `DELETE /api/v1/posts/:id`      | Posts      | delete | admin only   |
| `GET /api/v1/categories`        | Categories | read   | admin + user |
| `GET /api/v1/categories/:id`    | Categories | read   | admin + user |
| `POST /api/v1/categories`       | Categories | create | admin only   |
| `PATCH /api/v1/categories/:id`  | Categories | update | admin only   |
| `DELETE /api/v1/categories/:id` | Categories | delete | admin only   |

### Public Routes (`@Public()`)

| Route                             | Description                  |
| --------------------------------- | ---------------------------- |
| `POST /api/v1/auth/register`      | User registration            |
| `POST /api/v1/auth/login`         | User login                   |
| `POST /api/v1/auth/refresh-token` | Token refresh                |
| `POST /api/v1/keycloak/setup`     | Keycloak authorization setup |

## Setup Guide

### Step 1: Enable Authorization on Keycloak Client

1. Open Keycloak Admin Console → `http://localhost:8080/admin`
2. Select your realm: **SYSTEM_REALM**
3. Go to **Clients** → click **api_client**
4. Go to **Settings** tab
5. Find **Authorization** toggle → set to **ON**
6. Click **Save**

### Step 2: Create Groups

1. Go to **Groups** in the left sidebar
2. Click **Create group**
3. Name: `admin` → Create
4. Click **Create group** again
5. Name: `user` → Create

### Step 3: Configure Environment

Update `.env` with group names (used by `findGroupByName` to look up group UUIDs):

```env
KEYCLOAK_ADMIN_GROUP_ID=admin
KEYCLOAK_USER_GROUP_ID=user
```

### Step 4: Start App & Run Setup

```bash
npm run start:dev
```

Then call the setup endpoint:

```bash
curl -X POST http://localhost:4001/api/v1/keycloak/setup
```

This creates:

- **4 scopes:** `create`, `read`, `update`, `delete`
- **2 resources:** `Posts`, `Categories` (each with all 4 scopes)
- **2 policies:** `admin-group-policy`, `user-group-policy`
- **8 permissions:** Scope-based permissions linking resources + scopes + policies

### Step 5: Assign Users to Groups

#### Option A: Keycloak Admin Console

1. Go to **Users** → select a user
2. Go to **Groups** tab
3. Click **Join** → select `admin` or `user` → **Join**

#### Option B: Programmatic (via API)

```typescript
// Assign user to 'user' group (read-only)
await keycloakService.addUserToGroup(userId, 'user');

// Assign user to 'admin' group (full CRUD)
await keycloakService.addUserToGroup(userId, 'admin');
```

#### Option C: Auto-Assignment on Registration

New users are **automatically assigned to the `user` group** during registration. See `src/modules/auth/auth.service.ts`:

```typescript
// After Keycloak user creation
await this.keycloakService.addUserToGroup(kcUser.id, 'user');
```

## Testing

### Login as user group (read-only)

```bash
# Login
curl -X POST http://localhost:4001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "yourpassword"}'

# Read posts (200 OK)
curl http://localhost:4001/api/v1/posts \
  -H "Authorization: Bearer <access_token>"

# Create post (403 Forbidden)
curl -X POST http://localhost:4001/api/v1/posts \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello", "content": "World"}'
```

### Login as admin group (full access)

```bash
# Login
curl -X POST http://localhost:4001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "yourpassword"}'

# Create post (201 Created)
curl -X POST http://localhost:4001/api/v1/posts \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello", "content": "World"}'
```

## How Permission Checks Work

```
Request → AuthGuard (validates JWT) → ResourceGuard
  → reads @Resource("Posts") + @Scopes("create")
  → calls Keycloak UMA endpoint (token introspection)
  → Keycloak checks: does user belong to a group with
    a policy granting "create" on "Posts"?
  → ALLOW → proceed | DENY → 403
```

**Note:** UMA resource/scope permissions are **not included** in the JWT payload. The `ResourceGuard` validates permissions via Keycloak's token introspection endpoint at runtime.

## Troubleshooting

| Issue                                          | Solution                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 403 on all endpoints                           | Ensure user is in `admin` or `user` group in Keycloak                            |
| 403 on `@Public()` routes                      | Ensure `policyEnforcement` is set to `PERMISSIVE`                                |
| Setup endpoint returns "Could not find client" | Ensure Authorization is ON on the client; setup looks up client UUID             |
| Token doesn't include UMA scopes               | This is expected — UMA permissions are checked via introspection, not JWT claims |
| `Group not found` error                        | Ensure groups `admin` and `user` exist in Keycloak                               |
| New users can't access resources               | Check user was added to a group; verify group has the correct permissions        |
