import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

enum TvRemoteCommand {
  up,
  down,
  left,
  right,
  select,
  back,
  channelUp,
  channelDown,
  playPause,
  info,
  menu,
}

/// Centralized RemoteKeyManager for Android TV / Google TV D-Pad & Media Keys.
class AndroidTvRemoteKeyManager {
  final void Function(TvRemoteCommand command) onCommand;
  final void Function(int digit) onDigit;
  DateTime _lastEventAt = DateTime.fromMillisecondsSinceEpoch(0);

  AndroidTvRemoteKeyManager({required this.onCommand, required this.onDigit});

  KeyEventResult handleKeyEvent(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }

    final now = DateTime.now();
    if (event is KeyRepeatEvent &&
        now.difference(_lastEventAt).inMilliseconds < 95) {
      return KeyEventResult.handled;
    }
    _lastEventAt = now;

    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowUp) {
      onCommand(TvRemoteCommand.up);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown) {
      onCommand(TvRemoteCommand.down);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowLeft) {
      onCommand(TvRemoteCommand.left);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowRight) {
      onCommand(TvRemoteCommand.right);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.select || key == LogicalKeyboardKey.enter) {
      onCommand(TvRemoteCommand.select);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.goBack || key == LogicalKeyboardKey.escape) {
      onCommand(TvRemoteCommand.back);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.channelUp) {
      onCommand(TvRemoteCommand.channelUp);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.channelDown) {
      onCommand(TvRemoteCommand.channelDown);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.mediaPlayPause) {
      onCommand(TvRemoteCommand.playPause);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.info) {
      onCommand(TvRemoteCommand.info);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.contextMenu) {
      onCommand(TvRemoteCommand.menu);
      return KeyEventResult.handled;
    }

    final digitVal = int.tryParse(key.keyLabel);
    if (digitVal != null && digitVal >= 0 && digitVal <= 9) {
      onDigit(digitVal);
      return KeyEventResult.handled;
    }

    return KeyEventResult.ignored;
  }
}
