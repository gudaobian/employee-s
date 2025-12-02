{
  "targets": [
    {
      "target_name": "linux_event_monitor",
      "sources": [
        "src/addon.cpp",
        "src/event_monitor.cpp",
        "src/libinput_backend.cpp",
        "src/x11_backend.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "/usr/include/libinput",
        "/usr/include/libudev"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ["OS=='linux'", {
          "cflags!": ["-fno-exceptions"],
          "cflags_cc!": ["-fno-exceptions"],
          "cflags": ["-std=c++17", "-pthread"],
          "cflags_cc": ["-std=c++17", "-pthread"],
          "libraries": [
            "-linput",
            "-ludev",
            "-lX11",
            "-lXtst",
            "-lXi",
            "-lpthread"
          ],
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS",
            "NAPI_VERSION=8"
          ]
        }]
      ]
    }
  ]
}
