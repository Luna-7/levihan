import json
import re

with open("src/data/rawZhStories.json", "r", encoding="utf-8") as f:
    stories = json.load(f)

# Comprehensive phrase and lexicon dictionaries for literary SnK translation
VOCAB = {
    # Names
    "艾伦·耶格尔": "Eren Yeager", "艾伦": "Eren",
    "三笠·阿克曼": "Mikasa Ackerman", "三笠": "Mikasa",
    "阿尔敏·阿诺德": "Armin Arlert", "阿尔敏": "Armin",
    "利威尔·阿克曼": "Levi Ackerman", "利威尔": "Levi",
    "韩吉·佐耶": "Hange Zoë", "韩吉": "Hange",
    "埃尔文·史密斯": "Erwin Smith", "埃尔文": "Erwin",
    "让·基尔希斯坦": "Jean Kirstein", "让": "Jean",
    "康尼·斯普林格": "Connie Springer", "康尼": "Connie",
    "萨莎·布劳斯": "Sasha Blouse", "萨莎": "Sasha",
    "克里斯塔·连兹": "Krista Lenz", "克里斯塔": "Krista",
    "希斯特利亚·雷斯": "Historia Reiss", "希斯特利亚": "Historia",
    "尤弥尔": "Ymir",
    "莱纳·布朗": "Reiner Braun", "莱纳": "Reiner",
    "贝尔托特·胡佛": "Bertolt Hoover", "贝尔托特": "Bertolt",
    "阿尼·利昂哈特": "Annie Leonhart", "阿尼": "Annie",
    "马可·博特": "Marco Bott", "马可": "Marco",
    "莫布里特·伯纳": "Moblit Berner", "莫布里特": "Moblit",
    "佩特拉·拉尔": "Petra Rall", "佩特拉": "Petra",
    "奥路欧·博查特": "Oluo Bozado", "奥路欧": "Oluo",
    "艾鲁多·金": "Eld Jinn", "艾鲁多": "Eld",
    "根塔·舒尔茨": "Gunther Schultz", "根塔": "Gunther",
    "妮法": "Nifa",
    "米克·扎卡里亚斯": "Miche Zacharius", "米克": "Miche",
    "纳纳巴": "Nanaba", "盖尔加": "Gelgar",
    "基斯·沙迪斯": "Keith Shadis", "基斯": "Keith",
    "汉尼斯": "Hannes",
    "奈尔·德克": "Nile Dawk", "奈尔": "Nile",
    "多托·匹克西斯": "Dot Pixis", "匹克西斯": "Pixis",
    "里柯·布伦斯卡": "Rico Brzenska", "里柯": "Rico",
    "尼克神父": "Pastor Nick", "尼克牧师": "Pastor Nick",
    "乌利": "Uri", "卡尔菈": "Carla", "格里沙": "Grisha",
    # Organizations & Places
    "新利威尔班": "New Levi Squad", "利威尔班": "Levi Squad",
    "调查兵团": "Survey Corps", "训练兵团": "Cadet Corps",
    "驻扎兵团": "Garrison", "宪兵团": "Military Police",
    "立体机动装置": "ODM gear", "立体机动": "ODM gear",
    "玛利亚之墙": "Wall Maria", "罗塞之墙": "Wall Rose", "席纳之墙": "Wall Sina",
    "特洛斯特区": "Trost District", "托洛斯特区": "Trost District", "特洛斯特": "Trost",
    "巨树森林": "Forest of Giant Trees",
    "奇行种": "Abnormal Titan", "巨人": "Titan",
    "分队长": "Section Commander", "兵长": "Captain", "团长": "Commander",
    "教官": "Instructor", "蒸土豆": "steamed potato", "土豆": "potato",
}

print("Loaded translator engine helper.")
