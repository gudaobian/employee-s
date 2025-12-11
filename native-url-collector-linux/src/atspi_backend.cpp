/**
 * AT-SPI Backend Implementation
 */

#include "atspi_backend.h"
#include <atspi/atspi.h>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <iostream>

namespace url_collector {

AtspiBackend::AtspiBackend()
    : m_initialized(false)
    , m_available(false) {
}

AtspiBackend::~AtspiBackend() {
    cleanup();
}

bool AtspiBackend::initialize() {
    if (m_initialized) {
        return m_available;
    }

    // 初始化 AT-SPI
    GError* error = nullptr;
    int result = atspi_init();

    if (result != 0) {
        std::cerr << "[ATSPI] Failed to initialize AT-SPI, code: " << result << std::endl;
        m_available = false;
    } else {
        m_available = true;
        std::cout << "[ATSPI] Initialized successfully" << std::endl;
    }

    m_initialized = true;
    return m_available;
}

void AtspiBackend::cleanup() {
    if (m_initialized && m_available) {
        // AT-SPI 清理
        atspi_exit();
    }
    m_initialized = false;
    m_available = false;
}

bool AtspiBackend::isAvailable() const {
    return m_available;
}

AtspiAccessible* AtspiBackend::findBrowserApplication(const std::vector<std::string>& processNames) {
    if (!m_available) {
        return nullptr;
    }

    // 获取桌面根对象
    AtspiAccessible* desktop = atspi_get_desktop(0);
    if (!desktop) {
        std::cerr << "[ATSPI] Failed to get desktop" << std::endl;
        return nullptr;
    }

    GError* error = nullptr;
    gint childCount = atspi_accessible_get_child_count(desktop, &error);

    if (error) {
        std::cerr << "[ATSPI] Error getting child count: " << error->message << std::endl;
        g_error_free(error);
        g_object_unref(desktop);
        return nullptr;
    }

    // 遍历所有应用窗口
    for (gint i = 0; i < childCount; i++) {
        error = nullptr;
        AtspiAccessible* app = atspi_accessible_get_child_at_index(desktop, i, &error);

        if (error) {
            g_error_free(error);
            continue;
        }

        if (!app) {
            continue;
        }

        // 获取应用名称
        gchar* appName = atspi_accessible_get_name(app, nullptr);
        if (!appName) {
            g_object_unref(app);
            continue;
        }

        std::string appNameStr = toLower(appName);
        g_free(appName);

        // 检查是否是目标浏览器
        bool isTarget = false;
        for (const auto& processName : processNames) {
            if (appNameStr.find(toLower(processName)) != std::string::npos) {
                isTarget = true;
                break;
            }
        }

        if (isTarget) {
            g_object_unref(desktop);
            return app;  // 返回找到的浏览器应用
        }

        g_object_unref(app);
    }

    g_object_unref(desktop);
    return nullptr;
}

std::string AtspiBackend::findAddressBarText(AtspiAccessible* root,
                                             const std::vector<std::string>& addressBarRoles,
                                             const std::vector<std::string>& addressBarNames) {
    if (!root || !m_available) {
        return "";
    }

    return findAddressBarRecursive(root, addressBarRoles, addressBarNames, 0, 15);
}

std::string AtspiBackend::findAddressBarRecursive(AtspiAccessible* obj,
                                                  const std::vector<std::string>& roles,
                                                  const std::vector<std::string>& names,
                                                  int depth,
                                                  int maxDepth) {
    if (!obj || depth > maxDepth) {
        return "";
    }

    GError* error = nullptr;

    // 获取角色名
    AtspiRole role = atspi_accessible_get_role(obj, &error);
    if (error) {
        g_error_free(error);
        return "";
    }

    gchar* roleNameC = atspi_accessible_get_role_name(obj, nullptr);
    std::string roleName = roleNameC ? toLower(roleNameC) : "";
    if (roleNameC) g_free(roleNameC);

    // 获取元素名称
    gchar* nameC = atspi_accessible_get_name(obj, nullptr);
    std::string name = nameC ? nameC : "";
    if (nameC) g_free(nameC);

    // 检查是否是地址栏
    bool roleMatches = containsAny(roleName, roles);

    if (roleMatches) {
        // 检查名称是否匹配地址栏模式
        bool nameMatches = false;
        for (const auto& pattern : names) {
            if (toLower(name).find(toLower(pattern)) != std::string::npos) {
                nameMatches = true;
                break;
            }
        }

        if (nameMatches || name.empty()) {
            // 尝试获取文本内容
            std::string text = getAccessibleText(obj);

            // 验证是否看起来像 URL
            if (!text.empty() &&
                (text.find("http") != std::string::npos ||
                 text.find("www.") != std::string::npos ||
                 text.find(".com") != std::string::npos ||
                 text.find(".org") != std::string::npos ||
                 text.find(".net") != std::string::npos ||
                 text.find(".io") != std::string::npos ||
                 text.find(".cn") != std::string::npos)) {
                return text;
            }
        }
    }

    // 递归检查子元素
    gint childCount = atspi_accessible_get_child_count(obj, &error);
    if (error) {
        g_error_free(error);
        return "";
    }

    for (gint i = 0; i < childCount; i++) {
        error = nullptr;
        AtspiAccessible* child = atspi_accessible_get_child_at_index(obj, i, &error);

        if (error) {
            g_error_free(error);
            continue;
        }

        if (child) {
            std::string result = findAddressBarRecursive(child, roles, names, depth + 1, maxDepth);
            g_object_unref(child);

            if (!result.empty()) {
                return result;
            }
        }
    }

    return "";
}

std::string AtspiBackend::getAccessibleText(AtspiAccessible* obj) {
    if (!obj) {
        return "";
    }

    GError* error = nullptr;

    // 获取 Text 接口
    AtspiText* text = atspi_accessible_get_text(obj);
    if (!text) {
        return "";
    }

    // 获取字符数
    gint charCount = atspi_text_get_character_count(text, &error);
    if (error) {
        g_error_free(error);
        g_object_unref(text);
        return "";
    }

    if (charCount <= 0) {
        g_object_unref(text);
        return "";
    }

    // 获取文本内容
    error = nullptr;
    gchar* textContent = atspi_text_get_text(text, 0, charCount, &error);

    if (error) {
        g_error_free(error);
        g_object_unref(text);
        return "";
    }

    std::string result;
    if (textContent) {
        result = textContent;
        g_free(textContent);
    }

    g_object_unref(text);
    return result;
}

bool AtspiBackend::containsAny(const std::string& str, const std::vector<std::string>& patterns) const {
    std::string lowerStr = toLower(str);
    for (const auto& pattern : patterns) {
        if (lowerStr.find(toLower(pattern)) != std::string::npos) {
            return true;
        }
    }
    return false;
}

std::string AtspiBackend::toLower(const std::string& str) const {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return result;
}

} // namespace url_collector
