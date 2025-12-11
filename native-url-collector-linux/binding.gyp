{
  "targets": [
    {
      "target_name": "linux_url_collector",
      "sources": [
        "src/addon.cpp",
        "src/url_collector.cpp",
        "src/atspi_backend.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<!@(pkg-config --cflags-only-I atspi-2 glib-2.0 | sed 's/-I//g')"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ["OS=='linux'", {
          "cflags!": ["-fno-exceptions"],
          "cflags_cc!": ["-fno-exceptions"],
          "cflags": [
            "-std=c++17",
            "-pthread",
            "<!@(pkg-config --cflags atspi-2 glib-2.0)"
          ],
          "cflags_cc": [
            "-std=c++17",
            "-pthread",
            "<!@(pkg-config --cflags atspi-2 glib-2.0)"
          ],
          "libraries": [
            "<!@(pkg-config --libs atspi-2 glib-2.0)",
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
