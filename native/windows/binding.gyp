{
  "targets": [
    {
      "target_name": "event_monitor",
      "sources": [
        "src/event_monitor.cpp",
        "src/keyboard_hook.cpp",
        "src/mouse_hook.cpp",
        "src/idle_detector.cpp",
        "src/message_pump.cpp",
        "src/active_window.cpp",
        "src/hardware_id.cpp"
      ],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17", "/EHsc"]
            }
          },
          "libraries": [
            "-luser32.lib",
            "-lkernel32.lib",
            "-lpsapi.lib",
            "-lwbemuuid.lib",
            "-lole32.lib",
            "-loleaut32.lib"
          ]
        }]
      ]
    }
  ]
}