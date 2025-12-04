{
  "targets": [
    {
      "target_name": "event_monitor",
      "sources": [
        "src/event_monitor.mm"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++20", "-stdlib=libc++"],
            "OTHER_LDFLAGS": ["-framework CoreGraphics", "-framework ApplicationServices"],
            "MACOSX_DEPLOYMENT_TARGET": "10.10"
          }
        }]
      ]
    }
  ]
}