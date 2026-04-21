SKILL_META = {
    "name": "BMI计算器",
    "icon": "⚖️",
    "category": "analysis",
    "description": "根据体重和身高计算BMI值，并评估体重状态"
}

def run(weight: float, height: float) -> str:
    """计算BMI并返回评估结果
    
    Args:
        weight: 体重（kg）
        height: 身高（m）
    
    Returns:
        包含BMI值和体重状态评估的字符串
    """
    # 参数验证
    if height <= 0:
        return "错误：身高必须大于0"
    if weight <= 0:
        return "错误：体重必须大于0"
    
    # 计算BMI
    bmi = weight / (height ** 2)
    
    # 根据BMI值评估体重状态
    if bmi < 18.5:
        status = "偏轻"
        advice = "建议适当增加营养摄入"
    elif bmi < 25:
        status = "正常"
        advice = "继续保持健康的生活方式"
    elif bmi < 30:
        status = "超重"
        advice = "建议适当增加运动量"
    else:
        status = "肥胖"
        advice = "建议咨询医生制定减重计划"
    
    # 格式化输出
    result = f"""
📊 BMI计算结果
━━━━━━━━━━━━━━━━
体重：{weight} kg
身高：{height} m
BMI值：{bmi:.2f}
体重状态：{status}
💡 建议：{advice}
━━━━━━━━━━━━━━━━
"""
    return result.strip()
