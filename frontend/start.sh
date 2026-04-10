#!/bin/bash

cd "$(dirname "$0")"
FRONTEND_PID_FILE="frontend.pid"
BACKEND_PID_FILE="backend.pid"

# 读取 .env 中的端口配置
if [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi
BACKEND_PORT=${PORT:-3001}
FRONTEND_PORT=${FRONTEND_PORT:-4000}

start_frontend() {
    if [ -f "$FRONTEND_PID_FILE" ] && kill -0 $(cat "$FRONTEND_PID_FILE") 2>/dev/null; then
        echo "前端已在运行，PID: $(cat $FRONTEND_PID_FILE)"
    else
        cd "$(dirname "$0")"
        python3 -m http.server $FRONTEND_PORT > /dev/null 2>&1 &
        echo $! > "$FRONTEND_PID_FILE"
        echo "✅ 前端已启动 (PID: $!) http://localhost:$FRONTEND_PORT"
    fi
}

start_backend() {
    if [ -f "$BACKEND_PID_FILE" ] && kill -0 $(cat "$BACKEND_PID_FILE") 2>/dev/null; then
        echo "后端已在运行，PID: $(cat $BACKEND_PID_FILE)"
    else
        cd "$(dirname "$0")/backend"
        node server.js > server.log 2>&1 &
        echo $! > "$BACKEND_PID_FILE"
        echo "✅ 后端已启动 (PID: $!) http://localhost:$BACKEND_PORT"
    fi
}

stop_frontend() {
    if [ -f "$FRONTEND_PID_FILE" ]; then
        PID=$(cat "$FRONTEND_PID_FILE")
        if kill -0 $PID 2>/dev/null; then
            kill $PID && echo "🛑 前端已停止 (PID: $PID)"
        fi
        rm -f "$FRONTEND_PID_FILE"
    fi
}

stop_backend() {
    if [ -f "$BACKEND_PID_FILE" ]; then
        PID=$(cat "$BACKEND_PID_FILE")
        if kill -0 $PID 2>/dev/null; then
            kill $PID && echo "🛑 后端已停止 (PID: $PID)"
        fi
        rm -f "$BACKEND_PID_FILE"
    fi
}

status() {
    echo "=== FlowMind 服务状态 ==="
    if [ -f "$FRONTEND_PID_FILE" ] && kill -0 $(cat "$FRONTEND_PID_FILE") 2>/dev/null; then
        echo "✅ 前端运行中 (PID: $(cat $FRONTEND_PID_FILE)) - http://localhost:$FRONTEND_PORT"
    else
        echo "❌ 前端未运行"
    fi
    if [ -f "$BACKEND_PID_FILE" ] && kill -0 $(cat "$BACKEND_PID_FILE") 2>/dev/null; then
        echo "✅ 后端运行中 (PID: $(cat $BACKEND_PID_FILE)) - http://localhost:$BACKEND_PORT"
    else
        echo "❌ 后端未运行"
    fi
}

case "$1" in
    start)
        echo "🚀 启动 FlowMind..."
        start_frontend
        start_backend
        echo ""
        echo "📍 前端: http://localhost:$FRONTEND_PORT"
        echo "📍 后端: http://localhost:$BACKEND_PORT"
        ;;
    stop)
        echo "🛑 停止 FlowMind..."
        stop_frontend
        stop_backend
        ;;
    restart)
        stop; sleep 1; start
        ;;
    status)
        status
        ;;
    *)
        echo "用法: ./start.sh {start|stop|restart|status}"
        exit 1
        ;;
esac
