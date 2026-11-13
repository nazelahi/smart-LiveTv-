# Platform Playback Compatibility Matrix

| Platform | Playback Engine | HLS (`.m3u8`) | MPEG-TS (`.ts`) | DASH (`.mpd`) | Custom HTTP Headers |
| --- | --- | --- | --- | --- | --- |
| **Android TV / Google TV** | AndroidX Media3 ExoPlayer | Full support | Full support | Full support | Supported via `DefaultHttpDataSource.Factory` |
| **Samsung Tizen TV** | `webapis.avplay` | Full support | Native hardware demux | Supported | Supported via `avplay.setCustomHeader` |
| **LG webOS TV** | Native webOS Media / HTML5 | Native MSE / HLS | Hardware-dependent | MSE / Shaka | Limited in browser `<video>` without proxy |
| **Web TV Preview** | `hls.js` + HTML5 Video | Full (CORS-enabled) | Not playable in standard `<video>` | Extension | Subject to browser CORS policy |

## Key Engineering Rules
- Never assume HTML5 `<video>` can decode raw MPEG-TS (`.ts`) streams; use Media3 ExoPlayer on Android TV and `webapis.avplay` on Samsung Tizen.
- Keep the playback surface alive during channel zapping where supported to reduce black-frame flash.
