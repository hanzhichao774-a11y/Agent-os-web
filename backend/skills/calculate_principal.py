SKILL_META = {
    "name": "计算本金",
    "icon": "💰",
    "category": "analysis",
    "description": "根据年利率和存款期限计算本金（现值）"
}

def run(final_amount: float, annual_rate: float, years: int) -> str:
    """计算本金
    
    根据终值（本息和）、年利率和存款年限，反推初始本金
    
    参数:
        final_amount: 终值/本息和（元）
        annual_rate: 年利率（%，如 3.5 表示 3.5%）
        years: 存款年限
    
    返回:
        本金金额（元），保留两位小数
    """
    rate = annual_rate / 100
    principal = final_amount / (1 + rate * years)
    interest = final_amount - principal
    
    return f"""本金计算结果:
━━━━━━━━━━━━━━━━━━
  终值/本息和: {final_amount:,.2f} 元
  年利率: {annual_rate}%
  存期: {years} 年
━━━━━━━━━━━━━━━━━━
  本金: {principal:,.2f} 元
  利息: {interest:,.2f} 元
━━━━━━━━━━━━━━━━━━
单利公式: 本金 × (1 + 年利率 × 年数) = 终值"""
