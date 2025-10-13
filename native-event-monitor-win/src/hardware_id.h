#ifndef HARDWARE_ID_H
#define HARDWARE_ID_H

#include <string>

/**
 * 硬件唯一标识符获取模块 - v3.0 单一来源版本
 *
 * 提供底层硬件级别的唯一标识符获取功能
 * - Mainboard UUID: 主板UUID (唯一且稳定的硬件标识)
 */

namespace HardwareID {
    /**
     * 获取主板UUID - 唯一且稳定的设备标识
     * 通过WMI查询Win32_ComputerSystemProduct.UUID
     * @return 主板UUID字符串 (格式: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX)
     * @throws 如果无法读取或UUID无效则抛出异常
     */
    std::string GetMainboardUUID();

    /**
     * @deprecated 已废弃 - CPU ProcessorID不唯一(同型号CPU相同)
     */
    std::string GetCPUProcessorID();

    /**
     * @deprecated 已废弃 - 主板序列号经常为空或默认值
     */
    std::string GetBaseboardSerial();

    /**
     * 硬件信息结构 - v3.0 仅包含UUID
     */
    struct HardwareInfo {
        std::string uuid;  // 主板UUID (唯一来源)
    };

    HardwareInfo GetAllHardwareInfo();
}

#endif // HARDWARE_ID_H
