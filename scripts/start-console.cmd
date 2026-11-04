@echo off
chcp 65001 >nul
rem 手动启动本地控制台（调试用）。数据目录默认 C:\Users\<你>\.dsh-service-hub\data
cd /d "%~dp0..\console"
title 本地控制台
node server.mjs