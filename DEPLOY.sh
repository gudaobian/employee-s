#!/bin/bash

# Employee Monitor 快速部署脚本
# 用于创建版本标签并触发GitHub Actions自动构建

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 显示标题
echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Employee Monitor 自动部署脚本                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# 检查git仓库
if [ ! -d .git ]; then
    echo -e "${RED}❌ 错误: 当前目录不是git仓库${NC}"
    exit 1
fi

# 检查是否有未提交的更改
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  警告: 发现未提交的更改${NC}"
    echo ""
    git status --short
    echo ""
    read -p "是否先提交这些更改? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "输入提交信息: " commit_msg
        git add .
        git commit -m "$commit_msg"
        echo -e "${GREEN}✅ 更改已提交${NC}"
    else
        echo -e "${RED}❌ 取消部署：请先提交或暂存更改${NC}"
        exit 1
    fi
fi

# 获取当前版本
current_version=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo -e "${BLUE}📌 当前版本: ${current_version}${NC}"

# 推荐新版本号
IFS='.' read -ra VERSION_PARTS <<< "${current_version//v/}"
major=${VERSION_PARTS[0]:-0}
minor=${VERSION_PARTS[1]:-0}
patch=${VERSION_PARTS[2]:-0}

patch_version="v${major}.${minor}.$((patch + 1))"
minor_version="v${major}.$((minor + 1)).0"
major_version="v$((major + 1)).0.0"

echo ""
echo -e "${YELLOW}建议的版本号:${NC}"
echo -e "  ${GREEN}1)${NC} $patch_version (补丁版本 - 修复bug)"
echo -e "  ${GREEN}2)${NC} $minor_version (次要版本 - 新功能)"
echo -e "  ${GREEN}3)${NC} $major_version (主要版本 - 重大更新)"
echo -e "  ${GREEN}4)${NC} 自定义版本号"
echo ""

read -p "选择版本类型 (1-4): " version_choice

case $version_choice in
    1)
        new_version=$patch_version
        ;;
    2)
        new_version=$minor_version
        ;;
    3)
        new_version=$major_version
        ;;
    4)
        read -p "输入自定义版本号 (格式: v1.2.3): " new_version
        # 验证版本号格式
        if ! [[ $new_version =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-.*)?$ ]]; then
            echo -e "${RED}❌ 版本号格式无效，应为: v1.2.3 或 v1.2.3-beta${NC}"
            exit 1
        fi
        ;;
    *)
        echo -e "${RED}❌ 无效选择${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}🎯 准备发布版本: ${new_version}${NC}"

# 输入版本说明
echo ""
read -p "输入版本说明 (可选，回车跳过): " version_message

if [ -z "$version_message" ]; then
    version_message="Version ${new_version}"
fi

# 确认信息
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo -e "${YELLOW}部署信息确认${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo -e "版本号: ${GREEN}${new_version}${NC}"
echo -e "说明: ${version_message}"
echo -e "分支: $(git branch --show-current)"
echo -e "提交: $(git rev-parse --short HEAD)"
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo ""

read -p "确认部署? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ 取消部署${NC}"
    exit 1
fi

# 推送当前分支
echo ""
echo -e "${BLUE}📤 推送当前分支到远程...${NC}"
git push origin $(git branch --show-current)

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 推送分支失败${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 分支推送成功${NC}"

# 创建标签
echo ""
echo -e "${BLUE}🏷️  创建版本标签...${NC}"
git tag -a "$new_version" -m "$version_message"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 创建标签失败${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 标签创建成功${NC}"

# 推送标签
echo ""
echo -e "${BLUE}📤 推送标签到远程...${NC}"
git push origin "$new_version"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 推送标签失败${NC}"
    echo -e "${YELLOW}💡 可以手动删除本地标签: git tag -d $new_version${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 标签推送成功${NC}"

# 完成
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            🎉 部署触发成功！                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📋 接下来会发生什么:${NC}"
echo -e "  1. GitHub Actions 自动开始构建"
echo -e "  2. 编译Windows原生模块 (包含消息泵修复)"
echo -e "  3. 打包Windows/macOS安装程序"
echo -e "  4. 创建GitHub Release并上传安装包"
echo ""
echo -e "${BLUE}🔗 查看构建进度:${NC}"
echo -e "  https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
echo -e "${BLUE}📦 下载安装包 (构建完成后):${NC}"
echo -e "  https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/releases/tag/$new_version"
echo ""
echo -e "${YELLOW}⏱️  预计构建时间: 15-30分钟${NC}"
echo ""
