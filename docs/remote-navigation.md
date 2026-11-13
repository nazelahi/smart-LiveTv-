# Remote Control Navigation Specification

## Centralized `RemoteKeyManager`
- **Web / Tizen / webOS**: `src/tv/RemoteKeyManager.ts`
- **Android TV / Google TV**: `apps/android-tv/lib/remote_key_manager.dart`

### Hardware Key Mappings
- `ArrowUp` / `ArrowDown`: Vertical navigation or Channel Up/Down during fullscreen playback.
- `ArrowLeft` / `ArrowRight`: Horizontal card/rail navigation.
- `Enter` / `DPAD_CENTER`: Select focused item or toggle fullscreen player overlay.
- `Escape` / `Backspace` / `10009` (Tizen) / `461` (webOS): Close overlay, exit fullscreen, or return to Home.
- `ChannelUp` (`427` / `PageUp`) & `ChannelDown` (`428` / `PageDown`): Tune next/previous channel without unmounting player surface.
- `0`–`9`: Numeric channel input buffer (1.1s commit window).
- `MediaPlayPause` (`415` / `19` / `10252` / `Space`): Toggle play/pause.
- `Info` (`457` / `i`): Toggle current & next EPG program overlay.
