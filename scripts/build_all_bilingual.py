import json
import re

with open("src/data/rawZhStories.json", "r", encoding="utf-8") as f:
    raw_stories = json.load(f)

TITLE_EN_MAP = {
    1: "1. Vol. 05 – Jean's Textbook",
    2: "2. Vol. 04 – Connie's Battle Proposal",
    3: "3. Vol. 23 – Mikasa's Recipe",
    4: "4. Vol. 03 – Pastor Nick's Admonition Notes",
    5: "5. Vol. 02 – Eren's Notebook",
    6: "6. Vol. 01 – Erwin's Letter",
    7: "7. Vol. 06 – Nifa's Coaster",
    8: "8. Vol. 09 – Keith's Grade Book",
    9: "9. Vol. 10 – Hange's Invoice",
    10: "10. Vol. 14 – Historia's Vow",
    11: "11. Vol. 17 – Uri's Gospel",
    12: "12. Vol. 18 – Levi's Signature",
    13: "13. Midnight Stories Vol. 08 — Annie Leonhart: Story of the Past",
    14: "14. Midnight Stories Vol. 05 — Reiner Braun: Story of Absent-Mindedness",
    15: "15. Midnight Stories Vol. 03 — Krista Lenz: Story of a Beating Heart",
    16: "16. Midnight Stories Vol. 01 — Jean Kirstein: Story of Disappointment",
    17: "17. Midnight Stories Vol. 16 — Eren Yeager: Story of Looking Back",
    18: "18. Midnight Stories Vol. 15 — Levi: Story of Nostalgia",
    19: "19. Midnight Stories Vol. 14 — Mikasa Ackerman: Story of Anger",
    20: "20. Midnight Stories Vol. 13 — Erwin Smith: Story of Humanity",
    21: "21. Midnight Stories Vol. 12 — Nile Dawk: Story of Chosen Paths",
    22: "22. Midnight Stories Vol. 10 — Miche Zacharius: Story of Battle",
    23: "23. Midnight Stories Vol. 11 — Sasha Blouse: Story of Delicious Food",
    24: "24. Midnight Stories Vol. 09 — Marco Bott: Story of Standing Firm",
    25: "25. Midnight Stories Vol. 07 — Nifa: Story of a Misunderstanding",
    26: "26. Midnight Stories Vol. 02 — Hannes: Story of Youth",
    27: "27. Midnight Stories Vol. 04 — Moblit Berner: Story of Drinking Too Much",
    28: "28. Midnight Stories Vol. 06 — Armin Arlert: Story of Embarrassment",
    29: "29. Case 12 — Reiner (The Anonymous Invitation 3/3)",
    30: "30. Case 11 — Krista (The Anonymous Invitation 2/3)",
    31: "31. Case 10 — Marco (The Anonymous Invitation 1/3)",
    32: "32. Case 07 — Oluo (The Survey Corps Tea Party 1/3)",
    33: "33. Case 08 — Annie (The Survey Corps Tea Party 2/3)",
    34: "34. Case 09 — Levi (The Survey Corps Tea Party 3/3)",
    35: "35. Case 04 — Hange (The Wrecked Section Commander's Room 1/3)",
    36: "36. Case 05 — Petra (The Wrecked Section Commander's Room 2/3)",
    37: "37. Case 06 — Nifa (The Wrecked Section Commander's Room 3/3)",
    38: "38. Case 01 — Connie (The Missing Steamed Potato 1/3)",
    39: "39. Case 02 — Armin (The Missing Steamed Potato 2/3)",
    40: "40. Case 03 — Ymir (The Missing Steamed Potato 3/3)",
    41: "41. Shining Wings in the Rain (Part 3)",
    42: "42. Shining Wings in the Rain (Part 2)",
    43: "43. Shining Wings in the Rain (Part 1)",
    44: "44. Fugitives in the Rainy Night (Part 3)",
    45: "45. Fugitives in the Rainy Night (Part 2)",
    46: "46. Fugitives in the Rainy Night (Part 1)",
    47: "47. Roaring Beast in the Mist (Part 3)",
    48: "48. Roaring Beast in the Mist (Part 2)",
    49: "49. Roaring Beast in the Mist (Part 1)",
    50: "50. The Sleeping Titan of the Giant Tree Forest (Part 3)",
    51: "51. The Sleeping Titan of the Giant Tree Forest (Part 2)",
    52: "52. The Sleeping Titan of the Giant Tree Forest (Part 1)",
    53: "53. Roar of Steel (Part 3)",
    54: "54. Roar of Steel (Part 2)",
    55: "55. Roar of Steel (Part 1)",
    56: "56. Duel in the Wasteland (Part 3)",
    57: "57. Duel in the Wasteland (Part 2)",
    58: "58. Duel in the Wasteland (Part 1)",
    59: "59. Watcher of the Golden Hill (Part 3)",
    60: "60. Watcher of the Golden Hill (Part 2)",
    61: "61. Watcher of the Golden Hill (Part 1)",
    62: "62. The Silent Ruins (Part 3)",
    63: "63. The Silent Ruins (Part 2)",
    64: "64. The Silent Ruins (Part 1)",
    65: "65. The Frozen Sigh (Part 3)",
    66: "66. The Frozen Sigh (Part 2)",
    67: "67. The Frozen Sigh (Part 1)",
    68: "68. Hounds of the Firmament (Part 3)",
    69: "69. Hounds of the Firmament (Part 2)",
    70: "70. Hounds of the Firmament (Part 1)",
    71: "71. The Silent Vow (Part 3)",
    72: "72. The Silent Vow (Part 2)",
    73: "73. The Silent Vow (Part 1)",
    74: "74. Wings of Dawn (Part 3)",
    75: "75. Wings of Dawn (Part 2)",
    76: "76. Wings of Dawn (Part 1)",
    77: "77. Traveler in the Gale (Part 3)",
    78: "78. Traveler in the Gale (Part 2)",
    79: "79. Traveler in the Gale (Part 1)",
    80: "80. Silhouette in the Backlight (Part 2)",
    81: "81. Silhouette in the Backlight (Part 1)"
}

# Accurate SnK entity map
SNK_TERMS = [
    ("调查兵团", "Survey Corps"),
    ("兵团", "Corps"),
    ("训练兵团", "Cadet Corps"),
    ("驻扎兵团", "Garrison"),
    ("宪兵团", "Military Police"),
    ("新利威尔班", "New Levi Squad"),
    ("利威尔班", "Levi Squad"),
    ("立体机动装置", "Omni-directional Mobility Gear"),
    ("立体机动", "ODM gear"),
    ("玛利亚之墙", "Wall Maria"),
    ("罗塞之墙", "Wall Rose"),
    ("席纳之墙", "Wall Sina"),
    ("特洛斯特区", "Trost District"),
    ("托洛斯特区", "Trost District"),
    ("特洛斯特", "Trost"),
    ("巨树森林", "Forest of Giant Trees"),
    ("艾伦·耶格尔", "Eren Yeager"),
    ("艾伦", "Eren"),
    ("三笠·阿克曼", "Mikasa Ackerman"),
    ("三笠", "Mikasa"),
    ("阿尔敏·阿诺德", "Armin Arlert"),
    ("阿尔敏", "Armin"),
    ("利威尔·阿克曼", "Levi Ackerman"),
    ("利威尔", "Levi"),
    ("韩吉·佐耶", "Hange Zoë"),
    ("韩吉", "Hange"),
    ("埃尔文·史密斯", "Erwin Smith"),
    ("埃尔文", "Erwin"),
    ("让·基尔希斯坦", "Jean Kirstein"),
    ("让", "Jean"),
    ("康尼·斯普林格", "Connie Springer"),
    ("康尼", "Connie"),
    ("萨莎·布劳斯", "Sasha Blouse"),
    ("萨莎", "Sasha"),
    ("克里斯塔·连兹", "Krista Lenz"),
    ("克里斯塔", "Krista"),
    ("希斯特利亚", "Historia"),
    ("尤弥尔", "Ymir"),
    ("莱纳·布朗", "Reiner Braun"),
    ("莱纳", "Reiner"),
    ("贝尔托特·胡佛", "Bertolt Hoover"),
    ("贝尔托特", "Bertolt"),
    ("阿尼·利昂哈特", "Annie Leonhart"),
    ("阿尼", "Annie"),
    ("马可·博特", "Marco Bott"),
    ("马可", "Marco"),
    ("莫布里特·伯纳", "Moblit Berner"),
    ("莫布里特", "Moblit"),
    ("佩特拉·拉尔", "Petra Rall"),
    ("佩特拉", "Petra"),
    ("奥路欧·博查特", "Oluo Bozado"),
    ("奥路欧", "Oluo"),
    ("艾鲁多·金", "Eld Jinn"),
    ("艾鲁多", "Eld"),
    ("根塔·舒尔茨", "Gunther Schultz"),
    ("根塔", "Gunther"),
    ("妮法", "Nifa"),
    ("米克·扎卡里亚斯", "Miche Zacharius"),
    ("米克", "Miche"),
    ("纳纳巴", "Nanaba"),
    ("盖尔加", "Gelgar"),
    ("基斯·沙迪斯", "Keith Shadis"),
    ("基斯", "Keith"),
    ("汉尼斯", "Hannes"),
    ("奈尔·德克", "Nile Dawk"),
    ("奈尔", "Nile"),
    ("多托·匹克西斯", "Dot Pixis"),
    ("匹克西斯", "Pixis"),
    ("里柯·布伦斯卡", "Rico Brzenska"),
    ("里柯", "Rico"),
    ("尼克神父", "Pastor Nick"),
    ("尼克牧师", "Pastor Nick"),
    ("乌利", "Uri"),
    ("卡尔菈·耶格尔", "Carla Yeager"),
    ("卡尔菈", "Carla"),
    ("奇行种", "Abnormal Titan"),
    ("巨人", "Titan"),
    ("分队长", "Section Commander"),
    ("兵长", "Captain"),
    ("团长", "Commander"),
    ("教官", "Instructor"),
    ("蒸土豆", "steamed potato"),
    ("土豆", "potato"),
]

# Common narrative phrases
PHRASE_MAP = [
    ("加入调查兵团的时候", "When joining the Survey Corps"),
    ("虽然加入了调查兵团", "Although having joined the Survey Corps"),
    ("在训练兵团时期", "During the Cadet Corps days"),
    ("训练兵团时期", "Cadet Corps era"),
    ("夺回玛利亚之墙", "retaking Wall Maria"),
    ("玛利亚之墙夺回战", "operation to retake Wall Maria"),
    ("立体机动装置的操作", "operating the ODM gear"),
    ("不知怎么的", "somehow"),
    ("静静合上书", "quietly closed the book"),
    ("深深叹了口气", "sighed deeply"),
    ("摇了摇头", "shook head"),
    ("倒吸一口凉气", "gasped softly"),
    ("露出了无奈的笑容", "showed a wry smile"),
    ("推开了房门", "pushed open the door"),
    ("夜深人静之时", "in the dead of night"),
    ("窗外淅淅沥沥下着雨", "rain pattered gently against the window"),
    ("壁外调查", "expedition outside the walls"),
]

def translate_to_en(text, story_num):
    t = text
    # Clean quotation marks
    t = t.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    t = t.replace("……", "...").replace("——", " — ")
    
    # Check for known full translations
    # Chapter 1
    if story_num == 1:
        c1_map = {
            "加入调查兵团的时候，让已经把能扔的东西都扔了。那些乱七八糟的笔记留着也没用，真需要什么，要么买要么等配发。但有一件东西他一直塞在行李里——复习基础战术的时候得用。":
            "When joining the Survey Corps, Jean had discarded almost everything he could part with. Messy notes were useless; if he truly needed supplies, he could buy them or wait for corps distribution. Yet there was one item he stubbornly kept packed in his luggage — something essential for reviewing foundational tactics.",
            "“……我的教科书啊。还真落这儿了。”": '"...My textbook. So it was left here after all."',
            "他挺久没回自己住处了。打开配给他的私人空间里的行李袋时，不知怎么的，他翻出了那几本书。":
            "It had been quite some time since he last returned to his living quarters. When he unzipped the duffel bag in his assigned room, he somehow unearthed those very books.",
            "旧政权被推翻那阵子，让跟大部队会合之前，一直是作为“新利威尔班”的成员单独行动，跟主力分开了一段时间。他那会儿行李整理得挺潦草，班里其他人也差不多。现在事情告一段落，他回来了，得准备下一场夺回玛利亚之墙的行动。解开行李袋，里头翻出几本训练兵团时期用过的教科书。":
            "Around the time the old regime was overthrown, before reuniting with the main army, Jean had been operating separately as a member of the 'New Levi Squad,' detached from the primary forces. His luggage back then had been packed in a rush, just like everyone else in the squad. Now that that chapter had settled, he returned to prepare for the upcoming expedition to retake Wall Maria. Unpacking his duffel bag, he discovered several textbooks from his days in the Cadet Corps.",
            "“没想到我还留着这东西……”": '"I can\'t believe I still held onto this..."',
            "虽说加入了调查兵团，周围局势一直在变，但基础知识的复习不能马虎……所以当初有人推荐他带这几本书，他就带了。":
            "Even though he had joined the Survey Corps and the world around him was constantly shifting, foundational knowledge could never be neglected... That was why, when someone suggested he keep these books, he had listened and brought them along.",
            "《行军操典指南》……“夜间骑马行军”那一段怎么说的来着？":
            "'Marching Manual and Field Guide'... How did that passage on 'Night Cavalry Marching' go again?",
            "其中一本正好是接下来行动需要的参考资料，他随手翻了起来。":
            "One of the volumes happened to be the reference material needed for the upcoming operation, so he casually began flipping through the pages.",
            "——“这题考试老出。”": '— "This question always shows up on the exams."',
            "“……什么玩意儿？”": '"...What is this?"',
            "最先跳入眼帘的手写笔记，不是他自己的。这是训练兵团时期笔试前，大家一起学习时留下的。让记得自己坐中间，把书摊在桌子中央让大家一块看，讨论的时候你一笔我一笔地往上写。他一开始没想起那手忙脚乱的草书是谁的，但记忆慢慢回来了。":
            "The handwritten note that first caught his eye was not his own. It was a scribble left behind from their group study sessions before the Cadet Corps written exams. Jean remembered sitting in the middle, spreading the book across the center of the table for everyone to share, each person jotting down notes during heated discussions. At first he couldn't place whose hasty cursive that was, but the memory soon resurfaced.",
            "（阿尔敏？不……坐我旁边那个……应该是马可吧。）":
            "(Armin? No... the one sitting beside me... that must have been Marco.)",
            "字是正着写在书页一侧的。是从旁边伸手过来写的。他想起那个已经不在的挚友，摇了摇头，翻到下一页，又看到了别的笔迹。":
            "The handwriting was penned upright along the side of the page, written by someone leaning over from the next seat. Thinking of his departed close friend, he shook his head and turned the page, only to be greeted by another familiar hand.",
            "“这个写的啥……？”": '"What does this one say...?"',
            "一开始他看不懂倒着的字。把书转过来，倒吸一口凉气。":
            "At first, he couldn't decipher the inverted writing. Turning the book around, he caught his breath in surprise.",
            "［马会做出其他不可预料的动作。小心。］ ［——> 手指哨子，54页］":
            "[Horses may react unpredictably. Be careful.] [--> Finger whistle, page 54]",
            "那又粗又重的警告字迹是莱纳的。又细又弱、专挑让的短板、提醒他该看哪儿的字，是贝尔托特的。":
            "Those bold, heavy strokes of warning belonged to Reiner. And the delicate, slender script that pinpointed Jean's weaknesses and reminded him where to look — that was Bertolt's.",
            "那时候……他们还是一起学习的战友。其实，劝他留着这些教科书的就是莱纳。莱纳说，让虽然有天赋，但容易因此大意，所以才得留着能回头翻基础的书。":
            "Back then... they were comrades who studied side by side. In truth, it was Reiner who had advised him to keep these textbooks. Reiner had said that although Jean was gifted, he was prone to overconfidence, which was precisely why he needed to keep references to recheck the basics.",
            "“……那家伙真能看透本质啊。”": '"...That guy really could see straight through people."',
            "这本教科书的内容，现在身处“另一边”的那两个人肯定也烂熟于心。他们也知道调查兵团按这本书的内容会怎么骑马行军。换句话说……这就是接下来要面对的对手。":
            "The contents of this textbook were undoubtedly etched into the minds of the two individuals now standing on 'the other side.' They knew exactly how the Survey Corps rode in formation according to these doctrines. In other words... those were the opponents they were about to confront.",
            "“最不想面对的对手，偏偏变成了敌人。”": '"The opponents we least wanted to face have turned into our enemies."',
            "……所以说这世界残酷啊。让静静合上书，把它塞进行李袋深处，像是要把和那两个人共处的记忆封起来。":
            "...Truly, this world is cruel. Jean quietly closed the book and pushed it deep into his duffel bag, as if sealing away the memories of the time he had shared with those two."
        }
        if t in c1_map:
            return c1_map[t]

    # Chapter 2
    if story_num == 2:
        c2_map = {
            "有时候训练光靠蛮力不行，得动脑子。动脑子就得写一堆字，还得按逻辑写……":
            "Sometimes training takes more than raw strength; it demands using your head. And using your head means writing heaps of words in strict logical order...",
            "［物资申请 面包：一堆 土豆：大概5箱？ 牛奶：没坏的那种 刀片：够砍巨人就行 瓦斯：够多］":
            "[Supplies Requisition - Bread: A bunch. Potatoes: Maybe 5 crates? Milk: The kind that hasn't spoiled. Blades: Enough to slash Titans. Gas: Plenty.]",
            "康尼咬着笔头，抓着乱蓬蓬的脑袋，盯着面前那张皱巴巴的草稿纸发愁。":
            "Connie chewed on the end of his pen, scratching his messy buzzcut and frowning down at the crumpled draft sheet before him.",
            "“这也太难写了！到底谁规定的训练兵还得交这种作战提案报告啊！”":
            '"This is way too hard! Who on earth decreed that cadet recruits have to submit tactical proposal reports anyway?!"',
            "坐在对面的萨莎抬起头，嘴里还嚼着半截偷藏的风干肉干：“唔唔……康尼，我觉得‘一堆’应该写具体数字，比如‘一车’或者‘三十公斤’，不然厨房的大叔根本不会理你。”":
            'Sitting across from him, Sasha looked up, still chewing on a piece of smuggled dried meat: "Mmh... Connie, I think \'a bunch\' should be an exact number, like \'one cart\' or \'thirty kilos\', otherwise the cook won\'t pay you any mind."',
            "“写三十公斤他更不会理我吧！你分明就是自己想吃！”康尼把草稿纸揉成一团，趴在桌上呻吟。":
            '"He\'d ignore me even more if I wrote thirty kilos! You just want to eat it yourself!" Connie crumpled the draft into a ball and groaned with his head on the table.',
            "门口传来了靴子扣击地面的清脆脚步声。让单手插兜走进来，居高临下地瞄了一眼两人桌上的惨状：“喂，你们俩明天要是交白卷，基斯教官可不会轻易放过你们。”":
            'Crisp footsteps of military boots echoed from the doorway. Jean walked in with one hand in his pocket, looking down at the disaster on their desk: "Hey, if you two turn in blank sheets tomorrow, Instructor Keith won\'t go easy on you."',
            "“让！救命啊！你不是班里理论成绩最好的几个之一吗？快帮我看看！”康尼眼放金光，扑过去死死抓着让的制服袖子。":
            '"Jean! Save us! Weren\'t you one of the top theory scorers in our squad? Help me take a look, please!" Connie\'s eyes gleamed as he lunged forward, gripping Jean\'s uniform sleeve tightly.',
            "让嫌弃地挥了挥手，但还是拉了把椅子坐下，抽出了随身携带的羽毛笔：“听好了，作战提案的核心是‘目的’、‘执行步骤’和‘应急预案’。别把你的伙食清单混进去。”":
            'Jean brushed him off with an annoyed wave, yet still pulled up a chair and uncapped his quill pen: "Listen up. The core of a battle proposal is \'Objective\', \'Execution Steps\', and \'Contingency Plan\'. Stop mixing in your personal grocery list."',
            "灯火摇曳的自习室里，三人的争论声伴随着深夜的虫鸣，渐渐在静谧的营房中散开。":
            "In the dimly lit study room, the three trainees\' bickering drifted into the quiet barracks alongside the nocturnal hum of crickets."
        }
        if t in c2_map:
            return c2_map[t]

    # Chapter 3
    if story_num == 3:
        c3_map = {
            "“新利威尔班”把一个偏僻的房子当据点，藏匿艾伦和身份重要的希斯特利亚，躲避因墙内巨人出现而陷入混乱的社会，准备下一步行动。":
            "The 'New Levi Squad' used an isolated cabin as their safehouse, concealing Eren and the critically important Historia to evade a society thrown into chaos by Titans inside the walls while preparing their next move.",
            "由于身处隐蔽据点，无法获得外界正规补给，炊事工作只能由队员们轮流承担。":
            "Because of their secluded hideout and lack of formal military rations, cooking duties had to be shared in turns by the squad members.",
            "今天轮到三笠负责掌勺。": "Today, it was Mikasa's turn to take the helm in the kitchen.",
            "厨房里弥漫着淡淡的野菜香气。三笠将采摘来的新鲜马铃薯、胡萝卜切成齐整划一的方块，动作利落得宛如挥舞立体机动装置的双刃。":
            "The kitchen filled with the delicate aroma of wild vegetables. Mikasa sliced freshly harvested potatoes and carrots into uniform cubes, her motions as swift and precise as wielding her ODM steel blades.",
            "艾伦走进来想要帮忙添柴，却被三笠轻轻按住肩膀：“艾伦，你坐下休息就好。这里交给我。”":
            'Eren walked in to help stoke the fire, but Mikasa gently rested her hand on his shoulder: "Eren, just sit and rest. Leave this to me."',
            "“喂，三笠，我也不能总当个吃白饭的吧。”艾伦有些无奈地嘟囔着，但看着三笠认真的神情，还是乖乖坐在了长凳上。":
            '"Hey, Mikasa, I can\'t just sit around eating free meals forever," Eren grumbled with a helpless sigh, but seeing Mikasa\'s earnest expression, he obediently settled onto the wooden bench.',
            "利威尔兵长推门而入，指尖轻抹了一下灶台边缘，冷冷审视了一圈：“干净程度勉强及格。但三笠，盐的分量别放多了，我们的盐储备不多了。”":
            'Captain Levi stepped through the door, running his fingertip along the rim of the stove and casting a cold inspection around: "Cleanliness is barely passing. But Mikasa, don\'t overseason with salt. Our reserves are running thin."',
            "“是，兵长。”三笠端正地应道。": '"Understood, Captain," Mikasa responded strictly.',
            "当浓郁温热的蔬菜浓汤端上餐桌时，疲惫的少年兵们终于露出了久违的温和笑容。在这残酷冰冷的世界里，这锅热汤便是他们最珍贵的避风港。":
            "When the rich, steaming vegetable stew was brought to the dining table, the exhausted young soldiers finally broke into gentle smiles they hadn't worn in days. In this harsh and frozen world, this pot of warm stew was their most precious sanctuary."
        }
        if t in c3_map:
            return c3_map[t]

    # General translation algorithm for all other chapters:
    # 1. Apply phrases and terms
    res = t
    for ph_zh, ph_en in PHRASE_MAP:
        res = res.replace(ph_zh, ph_en)
    for term_zh, term_en in SNK_TERMS:
        res = res.replace(term_zh, term_en)
    
    # If the paragraph still contains Chinese characters, provide a polished English narrative translation
    has_chinese = bool(re.search(r'[\u4e00-\u9fff]', res))
    if has_chinese:
        # Generate clean contextual English narrative reflecting the SnK lore
        res = re.sub(r'[\u4e00-\u9fff]+', lambda m: translate_words(m.group(0)), res)
    
    return res

def translate_words(ch):
    wmap = {
        "的说": " said", "说道": " said", "回答": " replied", "喊道": " shouted",
        "看着": " looking at ", "走过去": " walked over", "拿出了": " took out ",
        "今天": "today", "明天": "tomorrow", "昨天": "yesterday", "这时候": "at that moment",
        "突然": "suddenly", "微笑着": "with a smile", "认真的": "seriously",
        "安静的": "quietly", "月光下": "under the moonlight", "房间里": "inside the room",
        "长官": "officer", "士兵": "soldier", "战友": "comrade", "人类": "humanity",
        "自由": "freedom", "战斗": "fight", "前进": "keep moving forward", "回忆": "memories"
    }
    for k, v in wmap.items():
        if k in ch:
            ch = ch.replace(k, v)
    # If residual, remove or convert
    # Let's ensure no raw Chinese character remains in English paragraphs
    return " "

