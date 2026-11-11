/**
 * Typeroom's word list for the time and words modes.
 *
 * Written for this project (not derived from any third-party list): everyday English words a
 * typist meets constantly, lowercase a-z only so every keyboard layout can type them. Grouped
 * loosely by kind to keep the list easy to review. Licence: same as the Typeroom source.
 */
export const WORDS: readonly string[] = [
  // short function words
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'so', 'as', 'at', 'by', 'for', 'from', 'in', 'into',
  'of', 'off', 'on', 'onto', 'out', 'over', 'to', 'up', 'with', 'about', 'after', 'again', 'before',
  'below', 'between', 'during', 'under', 'until', 'while', 'than', 'then', 'when', 'where', 'which',
  'who', 'why', 'how', 'what', 'this', 'that', 'these', 'those', 'there', 'here', 'each', 'every',
  'some', 'any', 'many', 'much', 'more', 'most', 'few', 'less', 'other', 'such', 'only', 'own', 'same',
  'all', 'both', 'no', 'not', 'yes', 'just', 'also', 'very', 'too', 'still', 'even', 'ever', 'never',
  'always', 'often', 'soon', 'now', 'once', 'later', 'early', 'almost', 'enough', 'perhaps', 'quite',
  // pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'its', 'our', 'their', 'one', 'someone', 'everyone', 'nothing', 'something', 'anything',
  // verbs
  'be', 'is', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'make', 'made', 'take', 'took', 'give',
  'gave', 'get', 'got', 'go', 'went', 'come', 'came', 'see', 'saw', 'look', 'find', 'found', 'know',
  'knew', 'think', 'thought', 'tell', 'told', 'ask', 'say', 'said', 'feel', 'felt', 'keep', 'kept',
  'leave', 'left', 'bring', 'brought', 'begin', 'began', 'hold', 'held', 'turn', 'move', 'live', 'play',
  'run', 'walk', 'stand', 'sit', 'open', 'close', 'start', 'stop', 'try', 'need', 'want', 'like', 'use',
  'work', 'call', 'help', 'show', 'hear', 'read', 'write', 'learn', 'change', 'follow', 'build', 'grow',
  'carry', 'reach', 'remember', 'believe', 'happen', 'speak', 'spend', 'wait', 'watch', 'plan', 'build',
  'share', 'choose', 'answer', 'explain', 'listen', 'travel', 'measure', 'notice', 'return', 'finish',
  // nouns
  'time', 'year', 'day', 'week', 'night', 'morning', 'hour', 'minute', 'moment', 'world', 'life', 'way',
  'place', 'home', 'house', 'room', 'door', 'window', 'table', 'chair', 'road', 'street', 'city', 'town',
  'country', 'river', 'water', 'sea', 'island', 'mountain', 'hill', 'field', 'forest', 'tree', 'leaf',
  'flower', 'garden', 'stone', 'sand', 'fire', 'light', 'sun', 'moon', 'star', 'sky', 'cloud', 'rain',
  'snow', 'wind', 'air', 'earth', 'ground', 'paper', 'book', 'page', 'letter', 'word', 'line', 'story',
  'name', 'idea', 'question', 'reason', 'problem', 'answer', 'fact', 'point', 'part', 'side', 'end',
  'hand', 'head', 'face', 'eye', 'voice', 'heart', 'mind', 'body', 'friend', 'family', 'child', 'people',
  'person', 'group', 'team', 'school', 'class', 'lesson', 'music', 'song', 'game', 'race', 'number',
  'level', 'list', 'piece', 'thing', 'kind', 'form', 'shape', 'color', 'sound', 'picture', 'map', 'key',
  'plan', 'system', 'program', 'machine', 'engine', 'bridge', 'train', 'ship', 'car', 'bike', 'field',
  'market', 'money', 'price', 'food', 'bread', 'apple', 'coffee', 'tea', 'dinner', 'kitchen', 'animal',
  'bird', 'fish', 'horse', 'dog', 'cat', 'journey', 'region', 'season', 'summer', 'winter', 'spring',
  // adjectives
  'good', 'new', 'first', 'last', 'long', 'great', 'little', 'old', 'big', 'high', 'small', 'large',
  'next', 'young', 'important', 'few', 'public', 'bad', 'able', 'free', 'full', 'easy', 'hard', 'clear',
  'close', 'common', 'simple', 'strong', 'quick', 'slow', 'quiet', 'loud', 'bright', 'dark', 'warm',
  'cold', 'fresh', 'sharp', 'gentle', 'calm', 'steady', 'careful', 'honest', 'curious', 'brave', 'kind',
  'happy', 'ready', 'real', 'true', 'whole', 'short', 'wide', 'deep', 'near', 'far', 'certain', 'plain',
  'useful', 'patient', 'friendly', 'open', 'better', 'best', 'possible', 'different', 'special',
].filter((word, index, all) => all.indexOf(word) === index);
