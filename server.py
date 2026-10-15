"""Local-only static host and Chat Completions proxy. Python 3.11+, no dependencies."""
import argparse
import json
import mimetypes
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent / 'docs'
MAX_BODY = 65536
MAX_RESPONSE = 2 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def call_model(config, messages):
    base = config.get('base_url', '').rstrip('/')
    parsed = urlsplit(base)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('AI_BASE_URL需要HTTPS地址（本机测试除外）')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('AI_BASE_URL不能包含账号、查询参数或片段')
    payload = json.dumps({'model': config['model'], 'messages': messages, 'temperature': 0.2}).encode()
    request = Request(base + '/chat/completions', data=payload,
                      headers={'Authorization': 'Bearer ' + config['api_key'], 'Content-Type': 'application/json'})
    with build_opener(NoRedirect).open(request, timeout=45) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError('模型响应超过2MB，请缩小任务')
    data = json.loads(raw)
    content = data['choices'][0]['message']['content']
    if not isinstance(content, str) or not content.strip():
        raise ValueError('模型返回内容为空或格式不兼容')
    usage = data.get('usage')
    usage = {k: v for k, v in usage.items() if k in ('prompt_tokens', 'completion_tokens', 'total_tokens')
             and isinstance(v, int) and not isinstance(v, bool) and v >= 0} if isinstance(usage, dict) else None
    return {'content': content, 'usage': usage, 'model': config['model']}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_data(self, status, data, content_type='application/json; charset=utf-8'):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def local_request(self):
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in allowed:
            self.send_data(403, {'error': '只接受本机Host'})
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{host}' for host in allowed}:
            self.send_data(403, {'error': '拒绝跨源请求'})
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        path = unquote(urlsplit(self.path).path)
        if path == '/api/status':
            config = self.server.config
            self.send_data(200, {'configured': bool(config.get('api_key') and config.get('model') and config.get('base_url')),
                                 'model': config.get('model', ''), 'mode': 'local'})
            return
        target = (self.server.static_root / (path.lstrip('/') or 'index.html')).resolve()
        if not target.is_relative_to(self.server.static_root) or target.suffix not in {'.html', '.js', '.mjs', '.css', '.json', '.svg', '.png'} or not target.is_file():
            self.send_data(404, {'error': '文件不存在'})
            return
        mime = 'text/javascript' if target.suffix in ('.js', '.mjs') else mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self.send_data(200, target.read_bytes(), mime + ('; charset=utf-8' if mime.startswith('text/') else ''))

    def do_POST(self):
        if not self.local_request():
            return
        if self.path != '/api/generate':
            self.send_data(404, {'error': '接口不存在'})
            return
        if self.headers.get_content_type() != 'application/json':
            self.send_data(415, {'error': '请使用application/json'})
            return
        try:
            length = int(self.headers.get('Content-Length', '-1'))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.send_data(413, {'error': '请求须包含Content-Length且不超过64KB'})
            return
        try:
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(length))
            messages = data.get('messages') if isinstance(data, dict) else None
            if not isinstance(messages, list) or not 1 <= len(messages) <= 4:
                raise ValueError('messages应包含1—4条消息')
            for item in messages:
                if not isinstance(item, dict) or item.get('role') not in ('system', 'user') or not isinstance(item.get('content'), str) or not item['content'].strip():
                    raise ValueError('消息应包含system/user角色及非空文本')
        except (ValueError, UnicodeError, TimeoutError) as error:
            self.send_data(400, {'error': '请求无效：' + ('JSON格式错误' if isinstance(error, json.JSONDecodeError) else str(error))})
            return
        if not all(self.server.config.get(key) for key in ('api_key', 'model', 'base_url')):
            self.send_data(503, {'error': '请在启动服务前配置AI_API_KEY、AI_MODEL与AI_BASE_URL环境变量'})
            return
        try:
            self.send_data(200, call_model(self.server.config, messages))
        except HTTPError as error:
            error.close()
            self.send_data(502, {'error': f'模型服务HTTP {error.code}，请检查额度、模型名和接口配置；未自动重试'})
        except (URLError, TimeoutError, OSError):
            self.send_data(502, {'error': '模型连接失败或超时，请检查网络和接口地址；未自动重试'})
        except (KeyError, IndexError, TypeError, ValueError):
            self.send_data(502, {'error': '模型返回格式不兼容，请使用Chat Completions文本接口'})


def make_server(port=8765, config=None, root=None):
    app = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    app.daemon_threads = True
    app.static_root = Path(root or ROOT).resolve()
    app.config = config if config is not None else {'api_key': os.getenv('AI_API_KEY', ''),
                                                   'model': os.getenv('AI_MODEL', ''),
                                                   'base_url': os.getenv('AI_BASE_URL', '')}
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    app = make_server(args.port)
    print(f'Open http://127.0.0.1:{app.server_port} (Ctrl+C to stop)', flush=True)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.server_close()
