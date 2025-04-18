import requests

OLLAMA_API = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3"  # 可根据实际情况更换为你的本地模型名称

def ask_ollama(prompt, system_prompt=None):
    full_prompt = prompt
    if system_prompt:
        full_prompt = system_prompt + "\n" + prompt
    data = {
        "model": OLLAMA_MODEL,
        "prompt": full_prompt,
        "stream": False
    }
    try:
        response = requests.post(OLLAMA_API, json=data, timeout=60)
        response.raise_for_status()
        result = response.json()
        return result.get("response") or result.get("message") or ""
    except Exception as e:
        print(f"调用Ollama失败: {e}")
        return ""