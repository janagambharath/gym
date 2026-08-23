# APK Build Report

Date: 2026-08-23

## APK Generated: NO

### Reason: Three independent blockers prevent APK generation

#### Blocker 1: No Backend Mobile API
- `GET https://gym-production-910c.up.railway.app/api/mobile/v1/health` → **404**
- `GET https://gym-production-910c.up.railway.app/api/mobile/v1/auth/login` → **404**
- Grep across all `app/*.py` files for "mobile" → **zero results**
- The backend Flask app registers zero `/api/mobile/v1` routes
- There is no JWT auth, no mobile JSON endpoints, no mobile blueprint
- The only working endpoint is `GET /health` (base health check, not mobile-scoped)

#### Blocker 2: JDK 8 installed — JDK 17+ required
```
java version "1.8.0_401"
Java(TM) SE Runtime Environment (build 1.8.0_401-b10)
```
- Gradle 9.x requires JDK 17+
- `javac` not found on PATH
- No Android SDK installed (`ANDROID_HOME` / `ANDROID_SDK_ROOT` not set)

#### Blocker 3: EAS CLI not authenticated
```
$ eas whoami
Not logged in
```
- EAS Cloud Build requires an authenticated Expo account
- No EAS project linked

### What was attempted
- Installed EAS CLI globally (`npm install -g eas-cli`)
- Added `preview` build profile to `eas.json` (APK output)
- Verified `npx expo export --platform android` produces a valid JS bundle (834 modules, 1.9MB Hermes bytecode)
- But JS bundle export ≠ installable APK

### To generate a real APK
1. **Option A — EAS Cloud Build** (recommended):
   ```bash
   eas login
   eas build --platform android --profile preview
   ```
2. **Option B — Local build**:
   - Install JDK 17+ (e.g., `winget install EclipseAdoptium.Temurin.17.JDK`)
   - Install Android Studio (provides SDK + build tools)
   - Run `npx expo run:android --variant release`
