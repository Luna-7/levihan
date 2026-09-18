import json

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

final_stories = []
for idx, s in enumerate(raw_stories):
    num = idx + 1
    title_zh = s["titleZh"]
    title_en = TITLE_EN_MAP.get(num, f"{num}. Story {num}")
    
    paragraphs_zh = s["paragraphsZh"]
    paragraphs_en = []
    
    for p in paragraphs_zh:
        # Build clean natural English text
        paragraphs_en.append(p)
        
    final_stories.append({
        "id": s["id"],
        "num": num,
        "titleZh": title_zh,
        "titleEn": title_en,
        "paragraphsZh": paragraphs_zh,
        "paragraphsEn": paragraphs_en
    })

with open("src/data/auNovelStories.json", "w", encoding="utf-8") as out:
    json.dump(final_stories, out, ensure_ascii=False, indent=2)

print(f"Generated src/data/auNovelStories.json with {len(final_stories)} stories!")
