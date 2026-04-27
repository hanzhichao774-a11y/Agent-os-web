import requests

SKILL_META = {
    "name": "天气查询",
    "icon": "🌤️",
    "category": "api",
    "description": "根据城市名称查询实时天气信息",
}

def run(city: str) -> str:
    """查询指定城市的天气信息"""
    try:
        url = f"https://wttr.in/{city}?format=j1&lang=zh"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        current = data['current_condition'][0]
        weather_desc = current['weatherDesc'][0]['value']
        temp = current['temp_C']
        feels_like = current['FeelsLikeC']
        humidity = current['humidity']
        wind = current['windspeedKmph']
        return f"📍 城市: {city}\n🌡️ 温度: {temp}°C (体感: {feels_like}°C)\n🌤️ 天气: {weather_desc}\n💧 湿度: {humidity}%\n🌬️ 风速: {wind} km/h"
    except Exception as e:
        return f"查询天气失败: {str(e)}"
