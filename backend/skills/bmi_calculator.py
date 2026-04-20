SKILL_META = {
    "name": "BMI计算器",
    "icon": "🏋️",
    "category": "analysis",
    "description": "根据身高(米)和体重(千克)计算BMI指数并给出健康建议",
}

def run(height_m: float, weight_kg: float) -> str:
    bmi = weight_kg / (height_m ** 2)
    if bmi < 18.5:
        level = "偏瘦"
    elif bmi < 24:
        level = "正常"
    elif bmi < 28:
        level = "偏胖"
    else:
        level = "肥胖"
    return f"BMI = {bmi:.1f}，属于【{level}】范围"
