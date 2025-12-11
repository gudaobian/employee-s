/**
 * AT-SPI Backend
 * 使用 AT-SPI2 库访问浏览器地址栏
 */

#ifndef ATSPI_BACKEND_H
#define ATSPI_BACKEND_H

#include <string>
#include <vector>
#include <functional>

// Forward declarations for AT-SPI types
typedef struct _AtspiAccessible AtspiAccessible;

namespace url_collector {

/**
 * AT-SPI 后端类
 */
class AtspiBackend {
public:
    AtspiBackend();
    ~AtspiBackend();

    /**
     * 初始化 AT-SPI
     * @return 是否成功
     */
    bool initialize();

    /**
     * 清理资源
     */
    void cleanup();

    /**
     * 检查是否可用
     */
    bool isAvailable() const;

    /**
     * 查找浏览器应用窗口
     * @param processNames 浏览器进程名列表
     * @return 浏览器 Accessible 对象（需要调用者释放）
     */
    AtspiAccessible* findBrowserApplication(const std::vector<std::string>& processNames);

    /**
     * 在窗口中查找地址栏
     * @param root 根元素
     * @param addressBarRoles 地址栏角色名列表
     * @param addressBarNames 地址栏名称模式列表
     * @return 地址栏文本内容
     */
    std::string findAddressBarText(AtspiAccessible* root,
                                   const std::vector<std::string>& addressBarRoles,
                                   const std::vector<std::string>& addressBarNames);

private:
    /**
     * 递归查找地址栏元素
     */
    std::string findAddressBarRecursive(AtspiAccessible* obj,
                                        const std::vector<std::string>& roles,
                                        const std::vector<std::string>& names,
                                        int depth,
                                        int maxDepth);

    /**
     * 检查字符串是否包含任意模式（忽略大小写）
     */
    bool containsAny(const std::string& str, const std::vector<std::string>& patterns) const;

    /**
     * 转换为小写
     */
    std::string toLower(const std::string& str) const;

    /**
     * 获取 Accessible 对象的文本内容
     */
    std::string getAccessibleText(AtspiAccessible* obj);

    // 成员变量
    bool m_initialized;
    bool m_available;
};

} // namespace url_collector

#endif // ATSPI_BACKEND_H
