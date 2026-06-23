// 직업(역할) 정의 및 인원수별 배정표
// team: 'mafia' = 마피아 진영, 'citizen' = 시민 진영

export const ROLES = {
  mafia: {
    key: 'mafia',
    name: '마피아',
    team: 'mafia',
    emoji: '🔪',
    short: '밤마다 시민 1명을 제거합니다.',
    desc: '밤이 되면 동료 마피아와 비밀 채팅을 하고, 함께 제거할 대상 1명을 지목합니다. 들키지 않게 낮에는 시민인 척하세요.',
    nightAction: 'kill', // 대상 지목
  },
  spy: {
    key: 'spy',
    name: '스파이',
    team: 'mafia',
    emoji: '🕵️',
    short: '마피아 진영이지만 경찰에게 "시민"으로 보입니다.',
    desc: '당신은 마피아 편입니다. 마피아 비밀 채팅에 참여하며, 경찰이 조사해도 "시민"으로 나옵니다. 단, 직접 제거 능력은 없습니다.',
    nightAction: null,
  },
  police: {
    key: 'police',
    name: '경찰',
    team: 'citizen',
    emoji: '👮',
    short: '밤마다 1명을 조사해 마피아 여부를 확인합니다.',
    desc: '밤마다 한 명을 지목해 마피아 진영인지 시민 진영인지 확인합니다. (스파이는 시민으로 보입니다.)',
    nightAction: 'investigate',
  },
  doctor: {
    key: 'doctor',
    name: '의사',
    team: 'citizen',
    emoji: '💉',
    short: '밤마다 1명을 보호해 마피아 공격을 무효화합니다.',
    desc: '밤마다 한 명을 지목해 치료합니다. 그날 밤 그 사람이 마피아의 공격을 받으면 살아남습니다. (자신도 보호 가능)',
    nightAction: 'protect',
  },
  soldier: {
    key: 'soldier',
    name: '군인',
    team: 'citizen',
    emoji: '🪖',
    short: '마피아의 공격을 1회 버팁니다.',
    desc: '튼튼한 군인입니다. 마피아에게 처음 공격받았을 때 한 번은 죽지 않고 버팁니다. (두 번째 공격부터는 사망)',
    nightAction: null,
  },
  medium: {
    key: 'medium',
    name: '영매',
    team: 'citizen',
    emoji: '🔮',
    short: '전날 죽은 사람의 진영을 알 수 있습니다.',
    desc: '밤마다, 바로 전날(낮 투표·밤 사망 포함) 죽은 사람이 마피아 진영이었는지 시민 진영이었는지 알게 됩니다.',
    nightAction: null,
  },
  politician: {
    key: 'politician',
    name: '정치인',
    team: 'citizen',
    emoji: '🎩',
    short: '낮 투표에서 2표를 행사합니다.',
    desc: '영향력 있는 정치인입니다. 낮 투표 때 당신의 표는 2표로 계산됩니다.',
    nightAction: null,
  },
  reporter: {
    key: 'reporter',
    name: '기자',
    team: 'citizen',
    emoji: '📰',
    short: '밤에 1명을 취재하면 다음 날 그 직업이 공개됩니다.',
    desc: '밤마다 한 명을 취재할 수 있습니다. 다음 날 아침, 모두에게 그 사람의 정확한 직업이 공개됩니다. (단 한 번만 사용 가능)',
    nightAction: 'report',
    oneShot: true,
  },
  madam: {
    key: 'madam',
    name: '마담',
    team: 'citizen',
    emoji: '💋',
    short: '밤에 1명을 유혹해 다음 날 능력·투표를 봉쇄합니다.',
    desc: '밤마다 한 명을 유혹합니다. 유혹당한 사람은 그날 밤 능력을 쓰지 못하고, 다음 낮 투표도 하지 못합니다. (마피아도 봉쇄 가능)',
    nightAction: 'seduce',
  },
  lover: {
    key: 'lover',
    name: '연인',
    team: 'citizen',
    emoji: '💞',
    short: '연인끼리 밤에 비밀 채팅을 하며 생사를 함께합니다.',
    desc: '당신에게는 연인이 있습니다. 서로의 정체를 알고, 밤마다 둘만의 비밀 채팅을 합니다. 한 명이 죽으면 다른 한 명도 상사병으로 따라 죽습니다. 끝까지 함께 살아남는 것이 목표입니다.',
    nightAction: null,
  },
  citizen: {
    key: 'citizen',
    name: '일반 시민',
    team: 'citizen',
    emoji: '🧑',
    short: '특수 능력은 없지만 토론과 투표로 마피아를 찾습니다.',
    desc: '평범한 시민입니다. 능력은 없지만 날카로운 추리와 투표로 마피아를 색출하세요.',
    nightAction: null,
  },
};

// 인원수(8~12)별 직업 구성표
const COMPOSITION = {
  8:  ['mafia', 'mafia', 'police', 'doctor', 'soldier', 'medium', 'lover', 'lover'],
  9:  ['mafia', 'mafia', 'police', 'doctor', 'soldier', 'medium', 'politician', 'lover', 'lover'],
  10: ['mafia', 'mafia', 'spy', 'police', 'doctor', 'soldier', 'medium', 'politician', 'lover', 'lover'],
  11: ['mafia', 'mafia', 'spy', 'police', 'doctor', 'soldier', 'medium', 'politician', 'reporter', 'lover', 'lover'],
  12: ['mafia', 'mafia', 'spy', 'police', 'doctor', 'soldier', 'medium', 'politician', 'reporter', 'madam', 'lover', 'lover'],
};

export function getComposition(count) {
  return COMPOSITION[count] || null;
}

// 마피아 진영 인원수 미리보기 (로비 표시용)
export function compositionSummary(count) {
  const comp = getComposition(count);
  if (!comp) return null;
  const tally = {};
  for (const k of comp) tally[k] = (tally[k] || 0) + 1;
  return Object.entries(tally).map(([key, n]) => ({
    name: ROLES[key].name,
    emoji: ROLES[key].emoji,
    count: n,
    team: ROLES[key].team,
  }));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 플레이어 배열에 역할을 배정. 연인 2명은 서로를 partner 로 연결.
export function assignRoles(players) {
  const comp = getComposition(players.length);
  if (!comp) throw new Error('지원하지 않는 인원수입니다 (8~12인).');

  const roleKeys = shuffle(comp);
  const shuffledPlayers = shuffle(players);

  const loverIds = [];
  shuffledPlayers.forEach((p, i) => {
    const key = roleKeys[i];
    p.role = key;
    p.team = ROLES[key].team;
    p.alive = true;
    p.partnerId = null;
    p.soldierShield = key === 'soldier';
    p.abilityUsed = false;
    if (key === 'lover') loverIds.push(p.id);
  });

  // 연인 서로 연결
  if (loverIds.length === 2) {
    const [a, b] = loverIds;
    const pa = shuffledPlayers.find((p) => p.id === a);
    const pb = shuffledPlayers.find((p) => p.id === b);
    pa.partnerId = b;
    pb.partnerId = a;
  }

  return shuffledPlayers;
}
