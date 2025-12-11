/**
 * Linux URL Collector
 * 使用 AT-SPI 获取浏览器当前 URL
 */

#ifndef URL_COLLECTOR_H
#define URL_COLLECTOR_H

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <functional>

namespace url_collector {

/**
 * URL 采集结果
 */
struct URLResult {
    std::string url;
    std::string browser;
    std::string method;      // "atspi", "xdotool", "title"
    std::string quality;     // "high", "medium", "low"
    bool success;
    std::string error;
};

/**
 * 浏览器配置
 */
struct BrowserConfig {
    std::string name;
    std::vector<std::string> processNames;
    std::vector<std::string> addressBarRoles;
    std::vector<std::string> addressBarNames;
};

/**
 * Linux URL 采集器类
 */
class LinuxURLCollector {
public:
    LinuxURLCollector();
    ~LinuxURLCollector();

    /**
     * 初始化采集器
     * @return 是否成功初始化
     */
    bool initialize();

    /**
     * 清理资源
     */
    void cleanup();

    /**
     * 检查 AT-SPI 是否可用
     */
    bool isAtspiAvailable() const;

    /**
     * 获取支持的浏览器列表
     */
    std::vector<std::string> getSupportedBrowsers() const;

    /**
     * 获取浏览器当前 URL
     * @param browserName 浏览器名称
     * @param windowTitle 窗口标题（可选）
     * @return URL 采集结果
     */
    URLResult getActiveURL(const std::string& browserName,
                           const std::string& windowTitle = "");

private:
    /**
     * 通过 AT-SPI 获取 URL
     */
    URLResult getURLViaAtspi(const std::string& browserName);

    /**
     * 通过 xdotool + 剪贴板获取 URL
     */
    URLResult getURLViaClipboard(const std::string& browserName);

    /**
     * 从窗口标题中提取 URL
     */
    URLResult extractURLFromTitle(const std::string& title);

    /**
     * 标准化浏览器名称
     */
    std::string normalizeBrowserName(const std::string& browserName) const;

    /**
     * 验证 URL 格式
     */
    bool isValidURL(const std::string& url) const;

    /**
     * 标准化 URL
     */
    std::string normalizeURL(const std::string& url) const;

    /**
     * 执行 shell 命令
     */
    std::string executeCommand(const std::string& cmd, int timeoutMs = 5000) const;

    // 成员变量
    bool m_initialized;
    bool m_atspiAvailable;
    bool m_xdotoolAvailable;
    bool m_xclipAvailable;
    std::map<std::string, BrowserConfig> m_browserConfigs;
    std::string m_lastClipboardContent;
};

} // namespace url_collector

#endif // URL_COLLECTOR_H
