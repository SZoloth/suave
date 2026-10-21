import json
import unittest
from pathlib import Path

from spell import Speller

assets = json.loads((Path(__file__).parent / "index" / "assets.json").read_text())
speller = Speller.from_assets(assets)


class CorrectTest(unittest.TestCase):
    def test_fixes_misspelled_asset_words(self):
        cases = {
            "barel": "barrel",
            "streat lmap": "street lamp",
            "wooden chiar": "wooden chair",
            "lmap thats red": "lamp thats red",
            "rusty oil drumm": "rusty oil drum",
            "buton": "button",
            "cand y": "candy",
            "red barr el": "red barrel",
        }
        for typed, expected in cases.items():
            with self.subTest(typed=typed):
                self.assertEqual(speller.correct(typed), expected)

    def test_leaves_correct_queries_alone(self):
        for query in [
            "find me a lamp thats red",
            "stuff for a smugglers hideout",
            "compare the barrel and the wooden chair",
            "how big is the street lamp",
            "rocks",
            "toys",
            "garden party decorations",
            "dog skeleton",
            "greek column",
            "children's wooden toys",
            "candy",
            "intercom",
            "shirt",
            "out house",
            "a basket with apples i nit",
        ]:
            with self.subTest(query=query):
                self.assertEqual(speller.correct(query), query)


if __name__ == "__main__":
    unittest.main()
