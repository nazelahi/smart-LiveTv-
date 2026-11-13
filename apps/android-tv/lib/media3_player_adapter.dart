import 'package:flutter/services.dart';

/// Platform channel adapter bridging Flutter UI to AndroidX Media3 ExoPlayer.
/// Supports HLS (.m3u8), MPEG-TS (.ts), and DASH (.mpd) with persistent SurfaceView.
class Media3PlayerAdapter {
  static const MethodChannel _channel = MethodChannel('vanguard.iptv/media3');

  Future<void> tuneStream({
    required String streamUrl,
    required Map<String, String> httpHeaders,
    required String format,
  }) async {
    await _channel.invokeMethod('tuneStream', {
      'streamUrl': streamUrl,
      'httpHeaders': httpHeaders,
      'format': format,
    });
  }

  Future<void> setPlayWhenReady(bool play) async {
    await _channel.invokeMethod('setPlayWhenReady', {'play': play});
  }

  Future<void> selectAudioTrack(int trackIndex) async {
    await _channel.invokeMethod('selectAudioTrack', {'index': trackIndex});
  }

  Future<void> selectSubtitleTrack(int trackIndex) async {
    await _channel.invokeMethod('selectSubtitleTrack', {'index': trackIndex});
  }

  Future<void> setResizeMode(String mode) async {
    await _channel.invokeMethod('setResizeMode', {'mode': mode});
  }

  Future<void> release() async {
    await _channel.invokeMethod('release');
  }
}
