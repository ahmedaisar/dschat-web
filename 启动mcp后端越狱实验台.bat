@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0mcp-server"

echo ============================================
echo   EasyJailbreak MCP 后端启动器
echo ============================================

rem ---- 1. Python ----
where python >nul 2>nul
if errorlevel 1 (
  echo [1/5] 未找到 Python，尝试自动安装 ...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo       [错误] 未找到 Python 和 winget，请手动安装 Python 3.10+ 并勾选 Add to PATH
    pause
    exit /b 1
  )
  call winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo       [错误] Python 自动安装失败，请手动安装：https://www.python.org/downloads/
    pause
    exit /b 1
  )
  set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
) else (
  for /f "tokens=2 delims= " %%v in ('python -V 2^>^&1') do echo [1/5] Python 已安装（%%v）
)

rem ---- 2. 虚拟环境 ----
if not exist ".venv\Scripts\python.exe" (
  echo [2/5] 创建虚拟环境 .venv ...
  python -m venv --system-site-packages .venv
  if errorlevel 1 (
    echo       [错误] 虚拟环境创建失败
    pause
    exit /b 1
  )
) else (
  echo [2/5] 虚拟环境已存在
)
set "PY=.venv\Scripts\python.exe"

rem ---- 3. Python 依赖 ----
"%PY%" -c "import mcp, openai, jsonlines, nltk" >nul 2>nul
if errorlevel 1 (
  echo [3/5] 安装基础依赖 ...
  "%PY%" -m pip install --upgrade pip
  "%PY%" -m pip install mcp openai jsonlines nltk
  if errorlevel 1 (
    echo       [错误] 基础依赖安装失败
    pause
    exit /b 1
  )
) else (
  echo [3/5] 基础依赖已安装
)

rem EasyJailbreak 顶层 import 链还直接用到 numpy / pandas / requests / tqdm
"%PY%" -c "import numpy, pandas, requests, tqdm" >nul 2>nul
if errorlevel 1 (
  echo       安装 EasyJailbreak 需要的 numpy / pandas / requests / tqdm ...
  "%PY%" -m pip install numpy pandas requests tqdm
  if errorlevel 1 (
    echo       [错误] numpy / pandas / requests / tqdm 安装失败
    pause
    exit /b 1
  )
)

"%PY%" -c "import fastchat" >nul 2>nul
if errorlevel 1 (
  echo       安装 fastchat（仅用 conversation 模块）...
  "%PY%" -m pip install --no-deps fschat==0.2.34
)

"%PY%" -c "import torch, transformers" >nul 2>nul
if errorlevel 1 (
  echo       安装 torch（CPU 版）与 transformers，体积较大请耐心等待 ...
  "%PY%" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  if errorlevel 1 echo       [提示] torch 安装失败，请手动安装 CPU 版 torch
  "%PY%" -m pip install transformers
  if errorlevel 1 echo       [提示] transformers 安装失败
)

"%PY%" -c "import datasets" >nul 2>nul
if errorlevel 1 (
  echo       安装 datasets（可选，用于在线数据集）...
  "%PY%" -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple datasets
  if errorlevel 1 echo       [提示] datasets 安装失败，实验台会回退到内置测试语句
)

rem ---- 4. EasyJailbreak ----
if not exist "..\..\EasyJailbreak\easyjailbreak" (
  if "%EASYJAILBREAK_PATH%"=="" (
    echo [4/5] 未找到 EasyJailbreak 源码，先尝试 pip 安装（体积小，最省事）...
    "%PY%" -m pip install --no-deps easyjailbreak -i https://pypi.tuna.tsinghua.edu.cn/simple
    "%PY%" -c "import easyjailbreak" >nul 2>nul
    if errorlevel 1 (
      echo       pip 安装失败，尝试从 GitHub / 镜像克隆 ...
      where git >nul 2>nul
      if not errorlevel 1 (
        git clone --depth 1 https://github.com/EasyJailbreak/EasyJailbreak.git "..\..\EasyJailbreak"
        if not exist "..\..\EasyJailbreak\easyjailbreak" (
          echo       尝试镜像 ghproxy ...
          git clone --depth 1 https://ghproxy.net/https://github.com/EasyJailbreak/EasyJailbreak.git "..\..\EasyJailbreak"
        )
        if not exist "..\..\EasyJailbreak\easyjailbreak" (
          echo       尝试镜像 kkgithub ...
          git clone --depth 1 https://kkgithub.com/EasyJailbreak/EasyJailbreak.git "..\..\EasyJailbreak"
        )
      )
    )
    "%PY%" -c "import easyjailbreak" >nul 2>nul
    if errorlevel 1 (
      if not exist "..\..\EasyJailbreak\easyjailbreak" (
        echo [提示] 未能自动获取 EasyJailbreak，任选一种方式：
        echo    1. pip install --no-deps easyjailbreak
        echo    2. 下载 https://github.com/EasyJailbreak/EasyJailbreak 压缩包，解压到 ..\..\EasyJailbreak
        echo    3. 设置环境变量 EASYJAILBREAK_PATH 指向已下载的源码目录
      )
    )
  ) else (
    echo [4/5] 使用 EASYJAILBREAK_PATH=%EASYJAILBREAK_PATH%
  )
) else (
  echo [4/5] EasyJailbreak 源码已存在
)

rem ---- nltk 数据（AutoDAN 用，下载失败不影响 API 方法）----
"%PY%" -c "import nltk; nltk.download('stopwords', quiet=True)" >nul 2>nul

rem ---- EasyJailbreak 导入自检 ----
if "%EASYJAILBREAK_PATH%"=="" (set "CHECK_JB=..\..\EasyJailbreak") else (set "CHECK_JB=%EASYJAILBREAK_PATH%")
set "PYTHONPATH=%CHECK_JB%"
"%PY%" -c "import easyjailbreak" 2>"%TEMP%\easyjailbreak_import_error.txt"
if errorlevel 1 (
  echo [提示] EasyJailbreak 仍无法导入，错误如下：
  type "%TEMP%\easyjailbreak_import_error.txt"
  echo [提示] 把上面的错误发给我即可定位；常见原因是缺少 tqdm / requests / torch 等依赖
)
set "PYTHONPATH=" 

rem ---- 5. 启动 ----
echo [5/5] 启动 MCP 后端 http://127.0.0.1:8765/mcp
"%PY%" -m easyjailbreak_mcp --host 127.0.0.1 --port 8765
echo.
echo [退出] MCP 后端已停止
pause
