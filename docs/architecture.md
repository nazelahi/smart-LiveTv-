# Vanguard IPTV Studio — System Architecture

## 1. Two-Product Split
1. **Remote IPTV Administration Dashboard**: Authenticated web console (Firebase Auth + PostgreSQL via Drizzle ORM) for importing M3U playlists, applying non-destructive channel overrides, managing XMLTV EPG sources, pairing Smart TVs, and publishing versioned snapshots.
2. **Smart TV Client Applications**: Platform-specific TV interfaces (Web TV / Tizen / webOS in React + TypeScript, Android TV / Google TV in Flutter + AndroidX Media3 ExoPlayer) using revocable SHA-256 hashed device credentials (`viptv_...`) and local offline caching (IndexedDB / Drift SQLite).

## 2. Synchronization Workflow
1. Administrator edits channels or refreshes M3U -> saved as draft/overrides without disrupting live TVs.
2. Administrator publishes version -> immutable JSON snapshot written to `playlist_versions`, `playlists.active_version_number` incremented.
3. Server resolves central, group, and individual `device_assignments`, writes `sync_events`, and broadcasts `sync:update_available` over authenticated WebSocket `/ws/device`.
4. Connected TVs fetch `/api/device/config`, validate, persist locally in IndexedDB/SQLite, and acknowledge via `/api/device/sync/ack`.
5. Offline TVs synchronize automatically via WebSocket reconnect or periodic HTTP polling fallback.
