#!/bin/bash
#
# 清理异常 app.asar.backup 目录
#
# 问题背景：
# - 版本 1.0.152-1.0.153 中，AsarManager.ts 使用 fs-extra.copy() 导致创建了空目录而非备份文件
# - 此异常目录会干扰 Squirrel.Mac 的更新流程，导致应用崩溃
#
# 解决方案：
# - 删除异常目录
# - 此脚本安全执行，只删除空目录，不会影响正常备份文件
#

set -e

APP_PATH="/Applications/EmployeeSafety.app/Contents/Resources"
BACKUP_DIR="$APP_PATH/app.asar.backup"

echo "=== EmployeeSafety 异常备份目录清理工具 ==="
echo ""

# 检查应用是否存在
if [ ! -d "/Applications/EmployeeSafety.app" ]; then
    echo "❌ 错误: 未找到 EmployeeSafety.app"
    echo "   请确认应用已安装在 /Applications/ 目录"
    exit 1
fi

# 检查 backup 是否存在
if [ ! -e "$BACKUP_DIR" ]; then
    echo "✅ 无需清理: app.asar.backup 不存在"
    exit 0
fi

# 检查是否为目录（异常情况）
if [ -d "$BACKUP_DIR" ]; then
    echo "🔍 检测到异常目录: $BACKUP_DIR"

    # 检查是否为空目录
    if [ -z "$(ls -A "$BACKUP_DIR")" ]; then
        echo "   目录为空，这是 1.0.152-1.0.153 版本的已知问题"
        echo ""
        echo "正在清理..."

        # 删除空目录
        sudo rm -rf "$BACKUP_DIR"

        if [ $? -eq 0 ]; then
            echo "✅ 清理成功: 异常目录已删除"
            echo ""
            echo "📝 后续步骤:"
            echo "   1. 重新安装 1.0.154+ 版本（已修复此问题）"
            echo "   2. 或等待自动更新到 1.0.154+"
            echo "   3. 测试热更新功能是否正常"
        else
            echo "❌ 清理失败: 无法删除目录"
            echo "   请手动执行: sudo rm -rf '$BACKUP_DIR'"
            exit 1
        fi
    else
        echo "⚠️  警告: 目录非空，可能包含重要文件"
        echo "   目录内容:"
        ls -la "$BACKUP_DIR"
        echo ""
        echo "   请手动检查后决定是否删除"
        exit 1
    fi

elif [ -f "$BACKUP_DIR" ]; then
    # 正常的备份文件
    BACKUP_SIZE=$(stat -f%z "$BACKUP_DIR")
    echo "✅ 正常备份文件存在"
    echo "   大小: $((BACKUP_SIZE / 1024 / 1024)) MB"
    echo "   无需清理"
    exit 0
fi

echo ""
echo "=== 清理完成 ==="
