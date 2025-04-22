import requests

def translate_zh2en(text, api_url="https://translate.googleapis.com/translate_a/single"):
    # 使用 Google Translate API（无需API Key，适合小量请求）
    params = {
        'client': 'gtx',
        'sl': 'zh-CN',
        'tl': 'en',
        'dt': 't',
        'q': text
    }
    try:
        resp = requests.get(api_url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return ''.join([seg[0] for seg in data[0]])
    except Exception as e:
        # 兜底：如 Google Translate 失败，尝试用 DeepL 免费API（可扩展其它翻译源）
        try:
            deepl_url = "https://api-free.deepl.com/v2/translate"
            deepl_params = {
                'auth_key': 'your_deepl_api_key', # 如有免费key可填写
                'text': text,
                'source_lang': 'ZH',
                'target_lang': 'EN'
            }
            resp = requests.post(deepl_url, data=deepl_params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            return data['translations'][0]['text']
        except Exception as e2:
            print(f"翻译全部失败: {e2}")
            return text
