import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import server


class Provider(BaseHTTPRequestHandler):
    failure = False
    seen = None

    def do_POST(self):
        Provider.seen = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if Provider.failure:
            self.send_response(429)
            self.end_headers()
            self.wfile.write(b'private-provider-detail')
            return
        data = json.dumps({'choices': [{'message': {'content': '{"ok":true}'}}],
                           'usage': {'prompt_tokens': 5, 'completion_tokens': 3}}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = server.make_server(port=0, config={'api_key': '', 'model': '', 'base_url': ''})
        cls.thread = threading.Thread(target=cls.app.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.app.server_port}'
        cls.provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        threading.Thread(target=cls.provider.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.app.server_close()
        cls.provider.shutdown()
        cls.provider.server_close()

    def setUp(self):
        self.app.config = {'api_key': '', 'model': '', 'base_url': ''}
        Provider.failure = False

    def request(self, path='/', payload=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
        merged = {'Content-Type': 'application/json'}
        merged.update(headers or {})
        request = urllib.request.Request(self.url + path, data=data, headers=merged)
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read().decode()

    def configured(self):
        self.app.config = {'api_key': 'test-key-not-a-secret', 'model': 'stub-model',
                           'base_url': f'http://127.0.0.1:{self.provider.server_port}/v1'}

    def test_index_is_served(self):
        code, headers, text = self.request()
        self.assertEqual(code, 200)
        self.assertIn('<!doctype html>', text.lower())
        self.assertIn('nosniff', headers['X-Content-Type-Options'])

    def test_modules_have_browser_mime_type(self):
        code, headers, _ = self.request('/core.mjs')
        self.assertEqual(code, 200)
        self.assertIn('javascript', headers['Content-Type'])

    def test_status_never_exposes_key(self):
        self.configured()
        code, _, text = self.request('/api/status')
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(text)['configured'])
        self.assertNotIn('test-key-not-a-secret', text)

    def test_unconfigured_model_returns_actionable_error(self):
        code, _, text = self.request('/api/generate', {'messages': [{'role': 'user', 'content': 'hello'}]})
        self.assertEqual(code, 503)
        self.assertIn('AI_API_KEY', text)

    def test_cross_origin_is_rejected(self):
        code, _, _ = self.request('/api/generate', {}, {'Origin': 'https://evil.example'})
        self.assertEqual(code, 403)

    def test_foreign_host_is_rejected(self):
        self.assertEqual(self.request('/', headers={'Host': 'evil.example'})[0], 403)

    def test_source_and_path_traversal_are_not_served(self):
        self.assertEqual(self.request('/server.py')[0], 404)
        self.assertEqual(self.request('/%2e%2e/server.py')[0], 404)

    def test_invalid_json_is_a_client_error(self):
        self.assertEqual(self.request('/api/generate', raw=b'{')[0], 400)

    def test_wrong_content_type_is_rejected(self):
        self.assertEqual(self.request('/api/generate', {}, {'Content-Type': 'text/plain'})[0], 415)

    def test_large_body_is_rejected(self):
        self.assertEqual(self.request('/api/generate', raw=b'x' * 100000)[0], 413)

    def test_invalid_roles_are_rejected(self):
        self.assertEqual(self.request('/api/generate', {'messages': [{'role': 'tool', 'content': 'x'}]})[0], 400)

    def test_unknown_endpoint_is_not_silently_successful(self):
        self.assertEqual(self.request('/api/unknown', {})[0], 404)

    def test_mock_provider_contract(self):
        self.configured()
        code, _, text = self.request('/api/generate', {'messages': [{'role': 'user', 'content': 'test'}]})
        self.assertEqual(code, 200)
        data = json.loads(text)
        self.assertEqual(data['content'], '{"ok":true}')
        self.assertEqual(data['usage']['prompt_tokens'], 5)
        self.assertEqual(Provider.seen['model'], 'stub-model')

    def test_provider_error_redacts_upstream_body(self):
        self.configured()
        Provider.failure = True
        code, _, text = self.request('/api/generate', {'messages': [{'role': 'user', 'content': 'test'}]})
        self.assertEqual(code, 502)
        self.assertNotIn('private-provider-detail', text)


if __name__ == '__main__':
    unittest.main()
