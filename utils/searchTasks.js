const normalizeKeyPart = (value) =>
  String(value || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");

const dedupeTasks = (tasks) => {
  const seen = new Set();
  const unique = [];
  for (const task of tasks) {
    if (seen.has(task.key)) continue;
    seen.add(task.key);
    unique.push(task);
  }
  return unique;
};

export const buildSearchTasks = ({ keywords, provinces, locations }) => {
  const tasks = [];
  const addTask = ({ level, province, location, keyword }) => {
    const locationName = normalizeKeyPart(location);
    const keywordText = normalizeKeyPart(keyword);
    if (!locationName || !keywordText) return;

    tasks.push({
      level,
      province: normalizeKeyPart(province || locationName),
      location: locationName,
      keyword: keywordText,
      query: `${locationName} ${keywordText}`,
      key: [level, province || locationName, locationName, keywordText].map(normalizeKeyPart).join("__")
    });
  };

  for (const province of provinces || []) {
    for (const keyword of keywords || []) {
      addTask({ level: "province", province, location: province, keyword });
    }
  }

  for (const item of locations?.cityLevel || []) {
    for (const keyword of keywords || []) {
      addTask({ level: "city", province: item.province, location: item.name, keyword });
    }
  }

  for (const item of locations?.coastalDistrictLevel || []) {
    for (const keyword of keywords || []) {
      addTask({ level: "coastal_district", province: item.province, location: item.name, keyword });
    }
  }

  return dedupeTasks(tasks);
};
