package com.streamstein.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // MediaStorePlugin is NOT registered here: Tauri instantiates it by class name when Rust
    // calls api.register_android_plugin(...) in the plugin setup hook. A registration call in
    // this file does not compile — TauriActivity exposes no such method.
    super.onCreate(savedInstanceState)
  }
}
