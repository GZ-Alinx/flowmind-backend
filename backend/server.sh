#!/bin/bash

cd "$(dirname "$0")"
PID_FILE="server.pid"

start() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "服务已在运行，PID: $(cat $PID_FILE)"
        return 1
    fi
    node server.js > server.log 2>&1 &
    echo $! > "$PID_FILE"
    echo "服务已启动，PID: $!"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 $PID 2>/dev/null; then
            kill $PID
            rm -f "$PID_FILE"
            echo "服务已停止 (PID: $PID)"
        else
            echo "服务未在运行"
            rm -f "$PID_FILE"
        fi
    else
        echo "找不到 PID 文件，服务可能未运行"
    fi
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "服务运行中，PID: $(cat $PID_FILE)"
    else
        echo "服务未运行"
    fi
}

case "$1" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; sleep 1; start ;;
    status)  status ;;
    *)
        echo "用法: ./server.sh {start|stop|restart|status}"
        exit 1
        ;;
esac
