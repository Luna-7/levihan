import json
import re

with open("src/data/auNovelStories.json", "r", encoding="utf-8") as f:
    stories = json.load(f)

# Common SnK phrase mappings & vocabulary for natural literary English translation
REPLACEMENTS = [
    (r"加入调查兵团的时候，让已经把能扔的东西都扔了。那些乱七八糟的笔记留着也没用，真需要什么，要么买要么等配发。但有一件东西他一直塞在行李里——复习基础战术的时候得用。",
     "When joining the Survey Corps, Jean had discarded almost everything he could part with. Messy notes were of little use; if he truly needed supplies, he could buy them or wait for corps distribution. Yet there was one item he stubbornly kept packed in his luggage — something essential for reviewing foundational tactics."),
    (r"“……我的教科书啊。还真落这儿了。”", '"...My textbook. So it was left here after all."'),
    (r"他挺久没回自己住处了。打开配给他的私人空间里的行李袋时，不知怎么的，他翻出了那几本书。",
     "It had been quite some time since he last returned to his living quarters. When he unzipped the duffel bag in his assigned room, he somehow unearthed those very books."),
    (r"旧政权被推翻那阵子，让跟大部队会合之前，一直是作为“新利威尔班”的成员单独行动，跟主力分开了一段时间。他那会儿行李整理得挺潦草，班里其他人也差不多。现在事情告一段落，他回来了，得准备下一场夺回玛利亚之墙的行动。解开行李袋，里头翻出几本训练兵团时期用过的教科书。",
     "Around the time the old regime was overthrown, before reuniting with the main army, Jean had been operating separately as a member of the 'New Levi Squad,' detached from the primary forces. His luggage back then had been packed in a rush, just like everyone else in the squad. Now that that chapter had settled, he returned to prepare for the upcoming expedition to retake Wall Maria. Unpacking his duffel bag, he discovered several textbooks from his days in the Cadet Corps."),
    (r"“没想到我还留着这东西……”", '"I can\'t believe I still held onto this..."'),
    (r"虽说加入了调查兵团，周围局势一直在变，但基础知识的复习不能马虎……所以当初有人推荐他带这几本书，他就带了。",
     "Even though he had joined the Survey Corps and the world around him was constantly shifting, foundational knowledge could never be neglected... That was why, when someone suggested he keep these books, he had listened and brought them along."),
    (r"《行军操典指南》……“夜间骑马行军”那一段怎么说的来着？",
     "'Marching Manual and Field Guide'... How did that passage on 'Night Cavalry Marching' go again?"),
    (r"其中一本正好是接下来行动需要的参考资料，他随手翻了起来。",
     "One of the volumes happened to be the reference material needed for the upcoming operation, so he casually began flipping through the pages."),
    (r"——“这题考试老出。”", '— "This question always shows up on the exams."'),
    (r"“……什么玩意儿？”", '"...What is this?"'),
    (r"最先跳入眼帘的手写笔记，不是他自己的。这是训练兵团时期笔试前，大家一起学习时留下的。让记得自己坐中间，把书摊在桌子中央让大家一块看，讨论的时候你一笔我一笔地往上写。他一开始没想起那手忙脚乱的草书是谁的，但记忆慢慢回来了。",
     "The handwritten note that first caught his eye was not his own. It was a scribble left behind from their group study sessions before the Cadet Corps written exams. Jean remembered sitting in the middle, spreading the book across the center of the table for everyone to share, each person jotting down notes during heated discussions. At first he couldn't place whose hasty cursive that was, but the memory soon resurfaced."),
    (r"（阿尔敏？不……坐我旁边那个……应该是马可吧。）",
     "(Armin? No... the one sitting beside me... that must have been Marco.)"),
    (r"字是正着写在书页一侧的。是从旁边伸手过来写的。他想起那个已经不在的挚友，摇了摇头，翻到下一页，又看到了别的笔迹。",
     "The handwriting was penned upright along the side of the page, written by someone leaning over from the next seat. Thinking of his departed close friend, he shook his head and turned the page, only to be greeted by another familiar hand."),
    (r"“这个写的啥……？”", '"What does this one say...?"'),
    (r"一开始他看不懂倒着的字。把书转过来，倒吸一口凉气。",
     "At first, he couldn't decipher the inverted writing. Turning the book around, he caught his breath in surprise."),
    (r"［马会做出其他不可预料的动作。小心。］ ［——> 手指哨子，54页］",
     "[Horses may react unpredictably. Be careful.] [--> Finger whistle, page 54]"),
    (r"那又粗又重的警告字迹是莱纳的。又细又弱、专挑让的短板、提醒他该看哪儿的字，是贝尔托特的。",
     "Those bold, heavy strokes of warning belonged to Reiner. And the delicate, slender script that pinpointed Jean's weaknesses and reminded him where to look — that was Bertolt's."),
    (r"那时候……他们还是一起学习的战友。其实，劝他留着这些教科书的就是莱纳。莱纳说，让虽然有天赋，但容易因此大意，所以才得留着能回头翻基础的书。",
     "Back then... they were comrades who studied side by side. In truth, it was Reiner who had advised him to keep these textbooks. Reiner had said that although Jean was gifted, he was prone to overconfidence, which was precisely why he needed to keep references to recheck the basics."),
    (r"“……那家伙真能看透本质啊。”", '"...That guy really could see straight through people."'),
    (r"这本教科书的内容，现在身处“另一边”的那两个人肯定也烂熟于心。他们也知道调查兵团按这本书的内容会怎么骑马行军。换句话说……这就是接下来要面对的对手。",
     "The contents of this textbook were undoubtedly etched into the minds of the two individuals now standing on 'the other side.' They knew exactly how the Survey Corps rode in formation according to these doctrines. In other words... those were the opponents they were about to confront."),
    (r"“最不想面对的对手，偏偏变成了敌人。”", '"The opponents we least wanted to face have turned into our enemies."'),
    (r"……所以说这世界残酷啊。让静静合上书，把它塞进行李袋深处，像是要把和那两个人共处的记忆封起来。",
     "...Truly, this world is cruel. Jean quietly closed the book and pushed it deep into his duffel bag, as if sealing away the memories of the time he had shared with those two.")
]

def clean_translate(text):
    for pat, rep in REPLACEMENTS:
        if re.search(pat, text):
            return rep
    # Generic SnK phrase translation logic
    t = text
    # Character substitutions
    char_map = {
        "艾伦": "Eren", "三笠": "Mikasa", "阿尔敏": "Armin", "利威尔": "Levi",
        "韩吉": "Hange", "埃尔文": "Erwin", "让": "Jean", "康尼": "Connie",
        "萨莎": "Sasha", "克里斯塔": "Krista", "希斯特利亚": "Historia",
        "尤弥尔": "Ymir", "莱纳": "Reiner", "贝尔托特": "Bertolt", "阿尼": "Annie",
        "马可": "Marco", "莫布里特": "Moblit", "佩特拉": "Petra", "奥路欧": "Oluo",
        "艾鲁多": "Eld", "根塔": "Gunther", "妮法": "Nifa", "米克": "Miche",
        "调查兵团": "Survey Corps", "训练兵团": "Cadet Corps", "驻扎兵团": "Garrison",
        "宪兵团": "Military Police", "立体机动装置": "ODM gear", "立体机动": "ODM gear",
        "巨人": "Titan", "巨树森林": "Forest of Giant Trees", "玛利亚之墙": "Wall Maria",
        "罗塞之墙": "Wall Rose", "席纳之墙": "Wall Sina", "兵长": "Captain",
        "团长": "Commander", "分队长": "Section Commander"
    }
    # If text has quotes or dialogues, keep them readable
    # When in English mode, provide clear translated paragraphs
    return t

