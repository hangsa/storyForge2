from backend.style_engine.sandbox_renderer import compute_avg_length


def test_compute_avg_length_chinese():
    # Three Chinese sentences of 10/20/30 characters (excluding punctuation)
    text = "你好世界。今天天气非常的好像要下雨但是又晴朗了。"
    avg = compute_avg_length(text)
    # Should be > 0 and < 50
    assert 0 < avg < 50


def test_compute_avg_length_empty():
    assert compute_avg_length("") == 0.0


def test_compute_avg_length_single_sentence():
    assert compute_avg_length("只有一句。") > 0
