#include "hardware_id.h"
#include <windows.h>
#include <intrin.h>
#include <wbemidl.h>
#include <comdef.h>
#include <sstream>
#include <iomanip>
#include <stdexcept>

#pragma comment(lib, "wbemuuid.lib")

namespace HardwareID {

    /**
     * 获取主板UUID - 唯一且稳定的设备标识
     * 通过WMI查询Win32_ComputerSystemProduct.UUID
     */
    std::string GetMainboardUUID() {
        HRESULT hr;
        std::string uuid;

        // 初始化COM
        hr = CoInitializeEx(0, COINIT_MULTITHREADED);
        if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
            throw std::runtime_error("COM initialization failed");
        }

        // 设置COM安全级别
        hr = CoInitializeSecurity(
            NULL,
            -1,
            NULL,
            NULL,
            RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            NULL,
            EOAC_NONE,
            NULL
        );

        if (FAILED(hr) && hr != RPC_E_TOO_LATE) {
            CoUninitialize();
            throw std::runtime_error("COM security initialization failed");
        }

        IWbemLocator* pLoc = NULL;
        IWbemServices* pSvc = NULL;

        try {
            // 创建WMI Locator
            hr = CoCreateInstance(
                CLSID_WbemLocator,
                0,
                CLSCTX_INPROC_SERVER,
                IID_IWbemLocator,
                (LPVOID*)&pLoc
            );

            if (FAILED(hr)) {
                throw std::runtime_error("Failed to create IWbemLocator");
            }

            // 连接到WMI
            hr = pLoc->ConnectServer(
                _bstr_t(L"ROOT\\CIMV2"),
                NULL,
                NULL,
                0,
                NULL,
                0,
                0,
                &pSvc
            );

            if (FAILED(hr)) {
                throw std::runtime_error("Failed to connect to WMI");
            }

            // 设置代理安全级别
            hr = CoSetProxyBlanket(
                pSvc,
                RPC_C_AUTHN_WINNT,
                RPC_C_AUTHZ_NONE,
                NULL,
                RPC_C_AUTHN_LEVEL_CALL,
                RPC_C_IMP_LEVEL_IMPERSONATE,
                NULL,
                EOAC_NONE
            );

            if (FAILED(hr)) {
                throw std::runtime_error("Failed to set proxy blanket");
            }

            // 执行WMI查询 - 获取主板UUID
            IEnumWbemClassObject* pEnumerator = NULL;
            hr = pSvc->ExecQuery(
                bstr_t("WQL"),
                bstr_t("SELECT UUID FROM Win32_ComputerSystemProduct"),
                WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                NULL,
                &pEnumerator
            );

            if (FAILED(hr)) {
                throw std::runtime_error("WMI query failed");
            }

            // 获取查询结果
            IWbemClassObject* pclsObj = NULL;
            ULONG uReturn = 0;

            while (pEnumerator) {
                hr = pEnumerator->Next(WBEM_INFINITE, 1, &pclsObj, &uReturn);

                if (uReturn == 0) {
                    break;
                }

                VARIANT vtProp;
                VariantInit(&vtProp);

                // 获取UUID属性
                hr = pclsObj->Get(L"UUID", 0, &vtProp, 0, 0);

                if (SUCCEEDED(hr) && vtProp.vt == VT_BSTR && vtProp.bstrVal != NULL) {
                    // 转换BSTR到std::string
                    _bstr_t bstrUUID(vtProp.bstrVal);
                    uuid = (char*)bstrUUID;
                }

                VariantClear(&vtProp);
                pclsObj->Release();
                break;
            }

            pEnumerator->Release();
            pSvc->Release();
            pLoc->Release();
            CoUninitialize();

        } catch (...) {
            if (pSvc) pSvc->Release();
            if (pLoc) pLoc->Release();
            CoUninitialize();
            throw;
        }

        // 验证UUID有效性
        if (uuid.empty() ||
            uuid == "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" ||
            uuid == "00000000-0000-0000-0000-000000000000" ||
            uuid == "03000200-0400-0500-0006-000700080009") {
            throw std::runtime_error("Invalid or empty mainboard UUID");
        }

        return uuid;
    }

    /**
     * @deprecated 获取CPU ProcessorID - 已废弃，仅保留以保持向后兼容
     * 现代CPU不再提供唯一序列号，此函数返回处理器签名（型号标识）
     */
    std::string GetCPUProcessorID() {
        int cpuInfo[4] = {0};
        std::stringstream ss;

        // 获取厂商ID
        __cpuid(cpuInfo, 0);
        unsigned int vendorPart1 = cpuInfo[1];  // "Genu"
        unsigned int vendorPart2 = cpuInfo[3];  // "ineI"
        unsigned int vendorPart3 = cpuInfo[2];  // "ntel"

        // 获取处理器签名（型号标识，非唯一序列号）
        __cpuid(cpuInfo, 1);
        unsigned int processorSignature = cpuInfo[0];  // Family-Model-Stepping

        ss << std::hex << std::uppercase << std::setfill('0')
           << std::setw(8) << vendorPart1
           << std::setw(8) << vendorPart2
           << std::setw(8) << vendorPart3
           << std::setw(8) << processorSignature;

        return ss.str();
    }

    /**
     * 获取主板序列号
     * 通过WMI查询Win32_BaseBoard
     */
    std::string GetBaseboardSerial() {
        HRESULT hr;
        std::string serialNumber;

        // 初始化COM
        hr = CoInitializeEx(0, COINIT_MULTITHREADED);
        if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
            throw std::runtime_error("COM initialization failed");
        }

        // 设置COM安全级别
        hr = CoInitializeSecurity(
            NULL,
            -1,
            NULL,
            NULL,
            RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            NULL,
            EOAC_NONE,
            NULL
        );

        // 如果已经初始化过安全级别，忽略错误
        if (FAILED(hr) && hr != RPC_E_TOO_LATE) {
            CoUninitialize();
            throw std::runtime_error("COM security initialization failed");
        }

        IWbemLocator* pLoc = NULL;
        IWbemServices* pSvc = NULL;

        try {
            // 创建WMI Locator
            hr = CoCreateInstance(
                CLSID_WbemLocator,
                0,
                CLSCTX_INPROC_SERVER,
                IID_IWbemLocator,
                (LPVOID*)&pLoc
            );

            if (FAILED(hr)) {
                throw std::runtime_error("Failed to create IWbemLocator");
            }

            // 连接到WMI
            hr = pLoc->ConnectServer(
                _bstr_t(L"ROOT\\CIMV2"),
                NULL,
                NULL,
                0,
                NULL,
                0,
                0,
                &pSvc
            );

            if (FAILED(hr)) {
                throw std::runtime_error("Failed to connect to WMI");
            }

            // 设置代理安全级别
            hr = CoSetProxyBlanket(
                pSvc,
                RPC_C_AUTHN_WINNT,
                RPC_C_AUTHZ_NONE,
                NULL,
                RPC_C_AUTHN_LEVEL_CALL,
                RPC_C_IMP_LEVEL_IMPERSONATE,
                NULL,
                EOAC_NONE
            );

            if (FAILED(hr)) {
                throw std::runtime_error("Failed to set proxy blanket");
            }

            // 执行WMI查询
            IEnumWbemClassObject* pEnumerator = NULL;
            hr = pSvc->ExecQuery(
                bstr_t("WQL"),
                bstr_t("SELECT SerialNumber FROM Win32_BaseBoard"),
                WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                NULL,
                &pEnumerator
            );

            if (FAILED(hr)) {
                throw std::runtime_error("WMI query failed");
            }

            // 获取查询结果
            IWbemClassObject* pclsObj = NULL;
            ULONG uReturn = 0;

            while (pEnumerator) {
                hr = pEnumerator->Next(WBEM_INFINITE, 1, &pclsObj, &uReturn);

                if (uReturn == 0) {
                    break;
                }

                VARIANT vtProp;
                VariantInit(&vtProp);

                // 获取SerialNumber属性
                hr = pclsObj->Get(L"SerialNumber", 0, &vtProp, 0, 0);

                if (SUCCEEDED(hr) && vtProp.vt == VT_BSTR && vtProp.bstrVal != NULL) {
                    // 转换BSTR到std::string
                    _bstr_t bstrSerial(vtProp.bstrVal);
                    serialNumber = (char*)bstrSerial;

                    // 验证序列号有效性
                    if (serialNumber != "To be filled by O.E.M." &&
                        serialNumber != "None" &&
                        serialNumber != "Default string" &&
                        serialNumber != "0" &&
                        !serialNumber.empty()) {
                        VariantClear(&vtProp);
                        pclsObj->Release();
                        break;
                    }
                }

                VariantClear(&vtProp);
                pclsObj->Release();
            }

            pEnumerator->Release();

        } catch (...) {
            if (pSvc) pSvc->Release();
            if (pLoc) pLoc->Release();
            CoUninitialize();
            throw;
        }

        if (pSvc) pSvc->Release();
        if (pLoc) pLoc->Release();
        CoUninitialize();

        if (serialNumber.empty()) {
            throw std::runtime_error("Failed to get baseboard serial number");
        }

        return serialNumber;
    }

    /**
     * 一次性获取所有硬件信息 - v3.0 仅获取主板UUID
     */
    HardwareInfo GetAllHardwareInfo() {
        HardwareInfo info;

        try {
            info.uuid = GetMainboardUUID();
        } catch (const std::exception& e) {
            throw std::runtime_error(std::string("Mainboard UUID retrieval failed: ") + e.what());
        }

        return info;
    }

} // namespace HardwareID
