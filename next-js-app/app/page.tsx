'use client';

import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 문제 타입 정의
interface QuizQuestion {
  id: number;
  passage: string;
  answer: string;
  explanation: string;
  category: string;
}

// 문제별 누적 통계
interface QuestionStat {
  questionId: number;
  tryCount: number;
  wrongCount: number;
  isResolved: boolean;
  isCorrect: boolean | null;
  lastSelectedAnswer: string | null;
  lastSolvedAt: string | null;
}

// 개별 풀이 시도 이력 로그
interface UserSubmissionLog {
  id: number;
  questionId: number;
  selectedAnswer: string;
  correctAnswer: string;
  isCorrect?: boolean;
  correct?: boolean;
  createdAt: string;
}

// 이력 채점 판정 헬퍼 (JSON 직렬화 및 정오답 비교 모두 안전하게 대응)
function isLogCorrect(log: UserSubmissionLog): boolean {
  if (log.isCorrect !== undefined && log.isCorrect !== null) return Boolean(log.isCorrect);
  if (log.correct !== undefined && log.correct !== null) return Boolean(log.correct);
  return String(log.selectedAnswer || '').trim() === String(log.correctAnswer || '').trim();
}

// AI 튜터 대화 이력 메시지
interface ConversationMessage {
  id: number;
  questionId: number;
  role: string;
  content: string;
  createdAt: string;
}

// 질문(user) + 답변(tutor) 묶음 단위
interface ConversationPair {
  id: number;
  questionId: number;
  userMessage?: ConversationMessage;
  tutorMessage?: ConversationMessage;
  createdAt: string;
}

function groupConversationPairs(messages: ConversationMessage[]): ConversationPair[] {
  const pairs: ConversationPair[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const next = messages[i + 1];
      if (next && next.role !== 'user') {
        pairs.push({
          id: msg.id,
          questionId: msg.questionId,
          userMessage: msg,
          tutorMessage: next,
          createdAt: msg.createdAt || next.createdAt,
        });
        i += 2;
      } else {
        pairs.push({
          id: msg.id,
          questionId: msg.questionId,
          userMessage: msg,
          createdAt: msg.createdAt,
        });
        i += 1;
      }
    } else {
      pairs.push({
        id: msg.id,
        questionId: msg.questionId,
        tutorMessage: msg,
        createdAt: msg.createdAt,
      });
      i += 1;
    }
  }
  return pairs.reverse();
}

interface UserStatsResponse {
  totalQuestions: number;
  solvedCount: number;
  everWrongCount: number;
  perfectCount: number;
  totalAttempts: number;
  stats: QuestionStat[];
  submissionLogs?: UserSubmissionLog[];
  conversationMessages?: ConversationMessage[];
}

// 지문 파서 (본문과 ①, ②, ③, ④ 보기를 안정적으로 분리)
function parsePassage(passage: string) {
  const m1 = passage.indexOf('①');
  const m2 = passage.indexOf('②');
  const m3 = passage.indexOf('③');
  const m4 = passage.indexOf('④');

  if (m1 !== -1 && m2 !== -1 && m3 !== -1 && m4 !== -1 && m1 < m2 && m2 < m3 && m3 < m4) {
    const questionText = passage.slice(0, m1).trim();
    const opt1 = passage.slice(m1, m2).trim().replace(/^①\s*/, '');
    const opt2 = passage.slice(m2, m3).trim().replace(/^②\s*/, '');
    const opt3 = passage.slice(m3, m4).trim().replace(/^③\s*/, '');
    const opt4 = passage.slice(m4).trim().replace(/^④\s*/, '');

    return {
      questionText,
      options: [
        { label: '①', text: opt1 },
        { label: '②', text: opt2 },
        { label: '③', text: opt3 },
        { label: '④', text: opt4 },
      ],
    };
  }

  return {
    questionText: passage,
    options: [],
  };
}

// 틀린 횟수(wrongCount)에 따른 시각적 그라데이션 스타일 계산 함수 (이모지 없이 깔끔한 디자인)
function getWrongHeatmapStyle(st: QuestionStat | null | undefined) {
  if (!st || st.tryCount === 0) {
    return {
      chip: 'bg-gray-100 text-gray-500 hover:bg-gray-200 border-gray-200',
      badge: 'bg-gray-100 text-gray-600 border-gray-200',
      text: '미풀이',
      level: 0,
    };
  }

  // 한 번의 오답도 없이 바로 맞힌 문제
  if (st.wrongCount === 0 && st.isCorrect) {
    return {
      chip: 'bg-emerald-500 text-white font-bold shadow-xs hover:bg-emerald-600 border border-emerald-600',
      badge: 'bg-emerald-50 border border-emerald-300 text-emerald-800',
      text: '원샷 정답 (오답 0회)',
      level: -1,
    };
  }

  const resolvedRing = st.isCorrect ? 'ring-2 ring-emerald-400 ring-offset-1' : '';

  // 1회 오답: 연한 옐로-호박색
  if (st.wrongCount === 1) {
    return {
      chip: `bg-amber-300 text-amber-950 font-bold border border-amber-400 shadow-2xs hover:bg-amber-400 ${resolvedRing}`,
      badge: 'bg-amber-50 border border-amber-300 text-amber-900',
      text: `1회 오답${st.isCorrect ? ' (재도전 정답)' : ''}`,
      level: 1,
    };
  }

  // 2회 오답: 주황색
  if (st.wrongCount === 2) {
    return {
      chip: `bg-orange-500 text-white font-bold border border-orange-600 shadow-xs hover:bg-orange-600 ${resolvedRing}`,
      badge: 'bg-orange-50 border border-orange-300 text-orange-900',
      text: `2회 오답${st.isCorrect ? ' (재도전 정답)' : ''}`,
      level: 2,
    };
  }

  // 3회 오답: 선명한 빨간색
  if (st.wrongCount === 3) {
    return {
      chip: `bg-rose-600 text-white font-bold border border-rose-700 shadow-xs hover:bg-rose-700 ${resolvedRing}`,
      badge: 'bg-rose-50 border border-rose-300 text-rose-900',
      text: `3회 오답 - 취약${st.isCorrect ? ' (재도전 정답)' : ''}`,
      level: 3,
    };
  }

  // 4회 이상: 짙은 암적색 / 딥 크림슨
  return {
    chip: `bg-purple-900 text-purple-100 font-extrabold border-2 border-rose-400 shadow-sm hover:bg-purple-950 ${resolvedRing}`,
    badge: 'bg-purple-100 border border-purple-400 text-purple-950 font-extrabold',
    text: `${st.wrongCount}회 누적 오답 - 고위험${st.isCorrect ? ' (재도전 정답)' : ''}`,
    level: 4,
  };
}

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  
  // 전체 문제 목록 & 풀이 통계 맵
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [userStatsMap, setUserStatsMap] = useState<Record<number, QuestionStat>>({});
  const [submissionLogsMap, setSubmissionLogsMap] = useState<Record<number, UserSubmissionLog[]>>({});
  const [conversationMessagesMap, setConversationMessagesMap] = useState<Record<number, ConversationMessage[]>>({});
  const [showAiHistoryOnCard, setShowAiHistoryOnCard] = useState(false);
  
  // 뷰 모드: 'dashboard' (메인 대시보드) | 'quiz' (문제 풀이)
  const [viewMode, setViewMode] = useState<'dashboard' | 'quiz'>('dashboard');

  // 학습 모드: 'SUBJECT' (과목별/단원별) | 'ROUND' (년도·회차별 기출)
  const [filterMode, setFilterMode] = useState<'SUBJECT' | 'ROUND'>('SUBJECT');
  
  // 과목별 필터 상태
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('ALL');

  // 년도/회차별 필터 상태
  const [selectedExamYear, setSelectedExamYear] = useState<string>('ALL');
  const [selectedRound, setSelectedRound] = useState<string>('ALL');
  const [selectedRoundSubject, setSelectedRoundSubject] = useState<string>('ALL');

  const [onlyWrongMode, setOnlyWrongMode] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // OMR 현황판 필터 (ALL | EVER_WRONG | WRONG_1 | WRONG_2 | WRONG_3_PLUS | CLEAN_PASS | UNSOLVED)
  const [omrFilter, setOmrFilter] = useState<'ALL' | 'EVER_WRONG' | 'WRONG_1' | 'WRONG_2' | 'WRONG_3_PLUS' | 'CLEAN_PASS' | 'UNSOLVED'>('ALL');
  
  // 답안 제출 중 상태
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 현재 문제 풀이 세션 상태 (새로 풀기 지원: 문제를 이동하거나 다시 풀 때 초기화됨)
  const [currentSessionAnswer, setCurrentSessionAnswer] = useState<string | null>(null);
  const [currentSessionResult, setCurrentSessionResult] = useState<{ isCorrect: boolean; correctAnswer: string } | null>(null);

  // AI 질의 상태
  const [askQuery, setAskQuery] = useState('');
  const [geminiResponse, setGeminiResponse] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  
  // UI 상태
  const [showAnswer, setShowAnswer] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);

  // 문제 풀기 진입 시 (처음부터 vs 진도 이어서) 선택 모달 상태
  const [startModalConfig, setStartModalConfig] = useState<{
    title: string;
    subtitle?: string;
    filterMode: 'SUBJECT' | 'ROUND';
    selectedSubject: string;
    selectedSubCategory: string;
    selectedExamYear: string;
    selectedRound: string;
    selectedRoundSubject: string;
    onlyWrongMode: boolean;
  } | null>(null);

  // 문제 인덱스나 필터가 변경될 때마다 현재 풀이 세션 리셋 (항상 새로 풀 수 있는 상태로 진입)
  useEffect(() => {
    setCurrentSessionAnswer(null);
    setCurrentSessionResult(null);
    setShowAnswer(false);
    setShowAiHistoryOnCard(false);
    setGeminiResponse('');
    setAskQuery('');
  }, [currentIndex, filterMode, selectedSubject, selectedSubCategory, selectedRound, selectedRoundSubject, onlyWrongMode]);

  // 과목 정의
  const subjects = [
    { id: 'ALL', name: '전체 문제' },
    { id: '컴퓨터 일반', name: '1과목 컴퓨터 일반' },
    { id: '스프레드시트 일반', name: '2과목 스프레드시트' },
    { id: '데이터베이스 일반', name: '3과목 데이터베이스' },
  ];

  // 초기 로드 시 로그인 상태 & 문제 및 통계 조회
  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    try {
      const res = await fetch('/api/quiz');
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.sort((a: QuizQuestion, b: QuizQuestion) => a.id - b.id));
        setIsLoggedIn(true);
        fetchStats();
      }
    } catch (error) {
      console.log('Not logged in or server error');
    } finally {
      setIsInitializing(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/quiz/stats', {
        headers: { 'X-User-Id': 'default_user' }
      });
      if (res.ok) {
        const data: UserStatsResponse = await res.json();
        const map: Record<number, QuestionStat> = {};
        if (data.stats) {
          data.stats.forEach(s => {
            map[s.questionId] = s;
          });
        }
        setUserStatsMap(map);

        const logsMap: Record<number, UserSubmissionLog[]> = {};
        if (data.submissionLogs) {
          data.submissionLogs.forEach(l => {
            if (!logsMap[l.questionId]) logsMap[l.questionId] = [];
            logsMap[l.questionId].push(l);
          });
        }
        setSubmissionLogsMap(logsMap);

        const convMap: Record<number, ConversationMessage[]> = {};
        if (data.conversationMessages) {
          data.conversationMessages.forEach(m => {
            if (!convMap[m.questionId]) convMap[m.questionId] = [];
            convMap[m.questionId].push(m);
          });
        }
        setConversationMessagesMap(convMap);
      }
    } catch (e) {
      console.error('Failed to fetch user stats', e);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        setIsLoggedIn(true);
        checkLoginStatus();
      } else {
        const errText = await res.text();
        setErrorMessage(errText || '로그인 실패!');
      }
    } catch (error) {
      setErrorMessage('서버와 연결할 수 없습니다.');
    }
  };

  // 기출문제 회차 집계 (년도 및 회차 자동 파싱)
  const examRounds = useMemo(() => {
    const map: Record<string, { id: string; year: string; round: string; questions: QuizQuestion[] }> = {};

    for (const q of questions) {
      const m = q.category.match(/(\d{4}년)\s*(상시\s*\d+회|\d+회)/);
      if (m) {
        const year = m[1];
        const round = m[2];
        const key = `${year} ${round}`;
        if (!map[key]) {
          map[key] = { id: key, year, round, questions: [] };
        }
        map[key].questions.push(q);
      }
    }

    return Object.values(map)
      .map(r => {
        const total = r.questions.length;
        let solved = 0;
        let everWrong = 0;
        let cleanPass = 0;
        for (const q of r.questions) {
          const st = userStatsMap[q.id];
          if (st && st.tryCount > 0) {
            solved++;
            if (st.wrongCount > 0) everWrong++;
            else if (st.isCorrect) cleanPass++;
          }
        }
        return {
          id: r.id,
          year: r.year,
          round: r.round,
          name: `${r.id} 기출문제`,
          total,
          solved,
          everWrong,
          cleanPass,
          progressRate: total > 0 ? Math.round((solved / total) * 100) : 0,
        };
      })
      .sort((a, b) => {
        const yA = parseInt(a.year) || 0;
        const yB = parseInt(b.year) || 0;
        if (yA !== yB) return yB - yA; // 최신 년도 우선
        return a.id.localeCompare(b.id);
      });
  }, [questions, userStatsMap]);

  // 등록된 기출문제 년도 목록
  const availableExamYears = useMemo(() => {
    return Array.from(new Set(examRounds.map(r => r.year))).sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0));
  }, [examRounds]);

  // 과목별 문항 수 집계
  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: questions.length };
    for (const q of questions) {
      const subject = q.category.split(' > ')[0]?.trim();
      if (subject) {
        counts[subject] = (counts[subject] || 0) + 1;
      }
    }
    return counts;
  }, [questions]);

  // 현재 과목에 해당하는 세부 단원 목록 집계
  const subCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of questions) {
      const [subject, sub] = q.category.split(' > ').map(s => s?.trim());
      if (selectedSubject === 'ALL' || subject === selectedSubject) {
        if (sub) {
          counts[sub] = (counts[sub] || 0) + 1;
        }
      }
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [questions, selectedSubject]);

  // 필터링된 문제 목록 (과목별 모드 or 년도/회차별 모드 지원)
  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      if (filterMode === 'ROUND') {
        if (selectedRound !== 'ALL') {
          const m = q.category.match(/(\d{4}년)\s*(상시\s*\d+회|\d+회)/);
          const roundKey = m ? `${m[1]} ${m[2]}` : null;
          if (roundKey !== selectedRound) {
            return false;
          }
        }
        if (selectedRoundSubject !== 'ALL') {
          const subject = q.category.split(' > ')[0]?.trim();
          if (subject !== selectedRoundSubject) {
            return false;
          }
        }
      } else {
        // SUBJECT 모드
        const [subject, sub] = q.category.split(' > ').map(s => s?.trim());
        if (selectedSubject !== 'ALL' && subject !== selectedSubject) {
          return false;
        }
        if (selectedSubCategory !== 'ALL' && sub !== selectedSubCategory) {
          return false;
        }
      }

      if (onlyWrongMode) {
        const st = userStatsMap[q.id];
        if (!st || st.wrongCount === 0) {
          return false;
        }
      }
      return true;
    });
  }, [questions, filterMode, selectedRound, selectedRoundSubject, selectedSubject, selectedSubCategory, onlyWrongMode, userStatsMap]);

  // 통계 집계: 한 번이라도 틀렸던 문제(everWrong) 및 횟수별 단계 집계
  const statsSummary = useMemo(() => {
    const total = questions.length;
    let solved = 0;
    let everWrong = 0;
    let cleanPass = 0;
    let wrong1 = 0;
    let wrong2 = 0;
    let wrong3Plus = 0;
    let totalAttempts = 0;

    for (const q of questions) {
      const st = userStatsMap[q.id];
      if (st && st.tryCount > 0) {
        solved++;
        totalAttempts += st.tryCount;
        if (st.wrongCount > 0) {
          everWrong++;
          if (st.wrongCount === 1) wrong1++;
          else if (st.wrongCount === 2) wrong2++;
          else wrong3Plus++;
        } else if (st.isCorrect) {
          cleanPass++;
        }
      }
    }

    return {
      total,
      solved,
      everWrong,
      cleanPass,
      wrong1,
      wrong2,
      wrong3Plus,
      totalAttempts,
      unsolved: total - solved,
      progressRate: total > 0 ? Math.round((solved / total) * 100) : 0,
    };
  }, [questions, userStatsMap]);

  // 3개 과목별 학습 현황 카드용 통계
  const subjectProgress = useMemo(() => {
    return ['컴퓨터 일반', '스프레드시트 일반', '데이터베이스 일반'].map(subj => {
      const subjQuestions = questions.filter(q => q.category.startsWith(subj));
      const total = subjQuestions.length;
      let solved = 0;
      let everWrong = 0;
      let cleanPass = 0;

      for (const q of subjQuestions) {
        const st = userStatsMap[q.id];
        if (st && st.tryCount > 0) {
          solved++;
          if (st.wrongCount > 0) everWrong++;
          else if (st.isCorrect) cleanPass++;
        }
      }

      return {
        id: subj,
        name: subj,
        total,
        solved,
        everWrong,
        cleanPass,
        progressRate: total > 0 ? Math.round((solved / total) * 100) : 0,
      };
    });
  }, [questions, userStatsMap]);

  // 문제 보기 클릭 시 답안 제출 및 채점 (이번 세션에 선택한 답안 반영)
  const handleSelectOption = async (optionLabel: string) => {
    if (isSubmitting || currentSessionAnswer) return;
    const currentQ = filteredQuestions[currentIndex];
    if (!currentQ) return;

    setIsSubmitting(true);
    setCurrentSessionAnswer(optionLabel);
    try {
      const res = await fetch(`/api/quiz/${currentQ.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'default_user' },
        body: JSON.stringify({ selectedAnswer: optionLabel }),
      });

      if (res.ok) {
        const result = await res.json();
        setCurrentSessionResult({
          isCorrect: result.isCorrect,
          correctAnswer: result.correctAnswer || currentQ.answer,
        });

        setUserStatsMap(prev => ({
          ...prev,
          [currentQ.id]: {
            questionId: currentQ.id,
            tryCount: result.tryCount,
            wrongCount: result.wrongCount,
            isResolved: result.isResolved,
            isCorrect: result.isCorrect,
            lastSelectedAnswer: result.selectedAnswer,
            lastSolvedAt: new Date().toISOString(),
          },
        }));

        if (result.attempts) {
          setSubmissionLogsMap(prev => ({
            ...prev,
            [currentQ.id]: result.attempts,
          }));
        }
      }
    } catch (error) {
      console.error('Error submitting answer:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 문제 다시 풀기 (현재 화면에서 새로 풀기 상태로 리셋)
  const handleResetCurrentSession = () => {
    setCurrentSessionAnswer(null);
    setCurrentSessionResult(null);
    setShowAnswer(false);
    setGeminiResponse('');
    setAskQuery('');
  };

  // 특정 필터 설정에 해당하는 문제 목록 계산 헬퍼
  const getQuestionsForConfig = (cfg: {
    filterMode: 'SUBJECT' | 'ROUND';
    selectedSubject: string;
    selectedSubCategory: string;
    selectedRound: string;
    selectedRoundSubject: string;
    onlyWrongMode: boolean;
  }) => {
    return questions.filter(q => {
      if (cfg.filterMode === 'ROUND') {
        if (cfg.selectedRound !== 'ALL') {
          const m = q.category.match(/(\d{4}년)\s*(상시\s*\d+회|\d+회)/);
          const roundKey = m ? `${m[1]} ${m[2]}` : null;
          if (roundKey !== cfg.selectedRound) {
            return false;
          }
        }
        if (cfg.selectedRoundSubject !== 'ALL') {
          const subject = q.category.split(' > ')[0]?.trim();
          if (subject !== cfg.selectedRoundSubject) {
            return false;
          }
        }
      } else {
        const [subject, sub] = q.category.split(' > ').map(s => s?.trim());
        if (cfg.selectedSubject !== 'ALL' && subject !== cfg.selectedSubject) {
          return false;
        }
        if (cfg.selectedSubCategory !== 'ALL' && sub !== cfg.selectedSubCategory) {
          return false;
        }
      }

      if (cfg.onlyWrongMode) {
        const st = userStatsMap[q.id];
        if (!st || st.wrongCount === 0) {
          return false;
        }
      }
      return true;
    });
  };

  // 문제 목록에 대한 진도율 및 이어서 풀 문제 인덱스 계산 헬퍼
  const computeProgressInfo = (targetQuestions: QuizQuestion[]) => {
    const total = targetQuestions.length;
    let solved = 0;
    let lastSolvedIdx = -1;
    let latestTimestamp = 0;
    let latestSolvedIdx = -1;

    targetQuestions.forEach((q, idx) => {
      const st = userStatsMap[q.id];
      if (st && st.tryCount > 0) {
        solved++;
        lastSolvedIdx = idx;
        if (st.lastSolvedAt) {
          const ts = new Date(st.lastSolvedAt).getTime();
          if (ts >= latestTimestamp) {
            latestTimestamp = ts;
            latestSolvedIdx = idx;
          }
        }
      }
    });

    const firstUnsolvedIdx = targetQuestions.findIndex(
      q => !userStatsMap[q.id] || userStatsMap[q.id].tryCount === 0
    );

    // 가장 최근(또는 마지막 번호)에 푼 문제 이후의 첫 미풀이 문제
    const anchorIdx = latestSolvedIdx !== -1 ? latestSolvedIdx : lastSolvedIdx;
    let nextAfterLastIdx = -1;
    if (anchorIdx !== -1 && anchorIdx + 1 < total) {
      for (let i = anchorIdx + 1; i < total; i++) {
        const st = userStatsMap[targetQuestions[i].id];
        if (!st || st.tryCount === 0) {
          nextAfterLastIdx = i;
          break;
        }
      }
      if (nextAfterLastIdx === -1) {
        nextAfterLastIdx = anchorIdx + 1;
      }
    }

    const resumeIdx = firstUnsolvedIdx !== -1
      ? firstUnsolvedIdx
      : (nextAfterLastIdx !== -1 ? nextAfterLastIdx : 0);

    return {
      total,
      solved,
      progressRate: total > 0 ? Math.round((solved / total) * 100) : 0,
      firstUnsolvedIdx,
      nextAfterLastIdx,
      resumeIdx,
    };
  };

  // 모달에서 시작 방식(처음부터 vs 이어서) 선택 후 실제 문제 풀이 화면으로 진입
  const handleConfirmStartQuiz = (startIndex: number) => {
    if (!startModalConfig) return;
    setFilterMode(startModalConfig.filterMode);
    setSelectedSubject(startModalConfig.selectedSubject);
    setSelectedSubCategory(startModalConfig.selectedSubCategory);
    setSelectedExamYear(startModalConfig.selectedExamYear);
    setSelectedRound(startModalConfig.selectedRound);
    setSelectedRoundSubject(startModalConfig.selectedRoundSubject);
    setOnlyWrongMode(startModalConfig.onlyWrongMode);
    setCurrentIndex(startIndex);
    handleResetCurrentSession();
    setStartModalConfig(null);
    setViewMode('quiz');
  };

  // 기출 회차 풀기 버튼 클릭 -> 처음부터 할지 진도를 이어서 할지 선택 모달 표시
  const handleStartRound = (roundId: string) => {
    const m = roundId.match(/(\d{4}년)/);
    const year = m ? m[1] : selectedExamYear;
    setStartModalConfig({
      title: `${roundId} 기출문제`,
      subtitle: '1과목~3과목 통합 실전 기출',
      filterMode: 'ROUND',
      selectedSubject: 'ALL',
      selectedSubCategory: 'ALL',
      selectedExamYear: year,
      selectedRound: roundId,
      selectedRoundSubject: 'ALL',
      onlyWrongMode: false,
    });
  };

  // 과목 선택 후 문제 풀기 버튼 클릭 -> 처음부터 할지 진도를 이어서 할지 선택 모달 표시
  const handleStartSubject = (subjId: string) => {
    const subjObj = subjects.find(s => s.id === subjId);
    setStartModalConfig({
      title: subjObj ? subjObj.name : subjId,
      subtitle: '과목별 집중 공략 학습',
      filterMode: 'SUBJECT',
      selectedSubject: subjId,
      selectedSubCategory: 'ALL',
      selectedExamYear: selectedExamYear,
      selectedRound: selectedRound,
      selectedRoundSubject: 'ALL',
      onlyWrongMode: false,
    });
  };

  // 전체 문제 풀기 / 이어서 풀기 버튼 클릭 -> 처음부터 할지 진도를 이어서 할지 선택 모달 표시
  const handleResumeLearning = () => {
    setStartModalConfig({
      title: '전체 문제 학습',
      subtitle: '전 과목 통합 문제 풀이',
      filterMode: 'SUBJECT',
      selectedSubject: 'ALL',
      selectedSubCategory: 'ALL',
      selectedExamYear: selectedExamYear,
      selectedRound: selectedRound,
      selectedRoundSubject: 'ALL',
      onlyWrongMode: false,
    });
  };

  // 오답노트 모아보기
  const handleStartWrongReview = () => {
    setFilterMode('SUBJECT');
    setSelectedSubject('ALL');
    setSelectedSubCategory('ALL');
    setOnlyWrongMode(true);
    setCurrentIndex(0);
    handleResetCurrentSession();
    setViewMode('quiz');
  };

  // OMR 그리드에서 특정 번호 클릭 시 직행
  const handleJumpToSpecificQuestion = (questionId: number) => {
    setFilterMode('SUBJECT');
    setSelectedSubject('ALL');
    setSelectedSubCategory('ALL');
    setOnlyWrongMode(false);
    const targetIdx = questions.findIndex(q => q.id === questionId);
    setCurrentIndex(targetIdx !== -1 ? targetIdx : 0);
    handleResetCurrentSession();
    setViewMode('quiz');
  };

  // 과목 선택 탭 변경 (진도가 있는 경우 처음부터/이어서 선택 모달 제공)
  const handleSelectSubject = (subjId: string) => {
    const nextCfg = {
      filterMode: 'SUBJECT' as const,
      selectedSubject: subjId,
      selectedSubCategory: 'ALL',
      selectedExamYear,
      selectedRound,
      selectedRoundSubject,
      onlyWrongMode,
    };
    const targetQs = getQuestionsForConfig(nextCfg);
    const prog = computeProgressInfo(targetQs);
    if (prog.solved > 0) {
      const subjObj = subjects.find(s => s.id === subjId);
      setStartModalConfig({
        title: subjObj ? subjObj.name : subjId,
        subtitle: '과목별 집중 학습',
        ...nextCfg,
      });
      return;
    }
    setSelectedSubject(subjId);
    setSelectedSubCategory('ALL');
    setCurrentIndex(0);
    handleResetCurrentSession();
  };

  // 세부 단원 변경 (진도가 있는 경우 처음부터/이어서 선택 모달 제공)
  const handleSelectSubCategory = (subCat: string) => {
    const nextCfg = {
      filterMode: 'SUBJECT' as const,
      selectedSubject,
      selectedSubCategory: subCat,
      selectedExamYear,
      selectedRound,
      selectedRoundSubject,
      onlyWrongMode,
    };
    const targetQs = getQuestionsForConfig(nextCfg);
    const prog = computeProgressInfo(targetQs);
    if (prog.solved > 0 && subCat !== 'ALL') {
      setStartModalConfig({
        title: `${selectedSubject === 'ALL' ? '전체 과목' : selectedSubject} - ${subCat}`,
        subtitle: '세부 단원 집중 학습',
        ...nextCfg,
      });
      return;
    }
    setSelectedSubCategory(subCat);
    setCurrentIndex(0);
    handleResetCurrentSession();
  };

  // 랜덤 문제
  const handleRandomQuestion = () => {
    if (filteredQuestions.length <= 1) return;
    let nextIdx = Math.floor(Math.random() * filteredQuestions.length);
    if (nextIdx === currentIndex) {
      nextIdx = (nextIdx + 1) % filteredQuestions.length;
    }
    setCurrentIndex(nextIdx);
    handleResetCurrentSession();
  };

  // 특정 문제의 AI 질문·답변 이력 다시 불러오기
  const fetchQuestionConversations = async (questionId: number) => {
    try {
      const res = await fetch(`/api/quiz/${questionId}/conversations`, {
        headers: { 'X-User-Id': 'default_user' },
      });
      if (res.ok) {
        const list: ConversationMessage[] = await res.json();
        setConversationMessagesMap(prev => ({
          ...prev,
          [questionId]: list,
        }));
        return true;
      }
    } catch (e) {
      console.error('Failed to fetch question conversations', e);
    }
    return false;
  };

  // 개별 AI 질문·답변 묶음 삭제
  const handleDeleteConversationPair = async (pair: ConversationPair) => {
    const primaryId = pair.userMessage?.id || pair.tutorMessage?.id;
    const secondaryId = pair.userMessage && pair.tutorMessage ? pair.tutorMessage.id : undefined;
    if (!primaryId) return;

    try {
      const query = secondaryId ? `?pairId=${secondaryId}` : '';
      const res = await fetch(`/api/quiz/conversations/${primaryId}${query}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': 'default_user' },
      });
      if (res.ok) {
        setConversationMessagesMap(prev => {
          const currentList = prev[pair.questionId] || [];
          const filtered = currentList.filter(
            m => m.id !== primaryId && m.id !== secondaryId
          );
          return {
            ...prev,
            [pair.questionId]: filtered,
          };
        });
      }
    } catch (e) {
      console.error('Failed to delete conversation pair', e);
    }
  };

  // 특정 문제의 AI 질문·답변 이력 전체 삭제
  const handleClearQuestionConversations = async (questionId: number) => {
    try {
      const res = await fetch(`/api/quiz/${questionId}/conversations`, {
        method: 'DELETE',
        headers: { 'X-User-Id': 'default_user' },
      });
      if (res.ok) {
        setConversationMessagesMap(prev => ({
          ...prev,
          [questionId]: [],
        }));
        setGeminiResponse('');
      }
    } catch (e) {
      console.error('Failed to clear question conversations', e);
    }
  };

  const handleAskGemini = async () => {
    if (!askQuery.trim()) return;
    if (filteredQuestions.length === 0) return;
    
    const currentQuestion = filteredQuestions[currentIndex];
    const submittedQuery = askQuery.trim();
    setIsAsking(true);
    setGeminiResponse('');
    
    try {
      const res = await fetch(`/api/quiz/${currentQuestion.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'default_user' },
        body: JSON.stringify({ query: submittedQuery })
      });
      
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;

        let buffer = '';
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr) {
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.text) {
                      setGeminiResponse(prev => prev + parsed.text);
                    }
                  } catch (e) {
                    // ignore
                  }
                }
              }
            }
          }
        }
        setAskQuery('');
        const synced = await fetchQuestionConversations(currentQuestion.id);
        if (synced) {
          setGeminiResponse('');
        }
      } else {
        setGeminiResponse('과외선생님 연결에 일시적인 지연이 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch (error) {
      setGeminiResponse('서버 연결 오류가 발생했습니다.');
    } finally {
      setIsAsking(false);
    }
  };

  const nextQuestion = () => {
    if (currentIndex < filteredQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      handleResetCurrentSession();
    }
  };

  const prevQuestion = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      handleResetCurrentSession();
    }
  };

  const handleJumpToIndex = (idx: number) => {
    if (idx >= 0 && idx < filteredQuestions.length) {
      setCurrentIndex(idx);
      handleResetCurrentSession();
    }
  };

  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center font-sans bg-slate-50 text-gray-700">
        <div className="text-center">
          <p className="font-semibold text-lg text-rose-500">컴활 1급 문제 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // --- 로그인 화면 ---
  if (!isLoggedIn) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-100 font-sans">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">컴활 1급 시험 대비</h1>
          <p className="text-center text-gray-500 text-sm mb-8">비밀번호를 입력하여 접속해주세요.</p>
          
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호" 
              className="px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
            />
            {errorMessage && <p className="text-red-500 text-sm font-medium">{errorMessage}</p>}
            <button 
              type="submit" 
              className="bg-rose-500 text-white font-bold py-3 rounded-lg hover:bg-rose-600 transition-colors shadow-md cursor-pointer"
            >
              로그인
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- 데이터 미등록 시 안내 화면 ---
  if (questions.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-50 font-sans">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">등록된 문제가 없습니다.</h2>
          <p className="text-gray-600">DB에 문제가 정상적으로 등록되었는지 확인해주세요.</p>
        </div>
      </div>
    );
  }

  const currentQ = filteredQuestions[currentIndex];
  const currentStat = currentQ ? userStatsMap[currentQ.id] : null;
  const currentAttempts = currentQ ? (submissionLogsMap[currentQ.id] || []) : [];
  const currentConversations = currentQ ? (conversationMessagesMap[currentQ.id] || []) : [];
  const currentConversationPairs = currentQ ? groupConversationPairs(currentConversations) : [];
  const allConversationPairs = Object.entries(conversationMessagesMap)
    .flatMap(([qIdStr, msgs]) => groupConversationPairs(msgs).map(p => ({ ...p, questionId: Number(qIdStr) })))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const parsedPassage = currentQ ? parsePassage(currentQ.passage) : null;
  const hasSessionAnswered = !!currentSessionAnswer;
  const hasWrongHistory = !!(currentStat && currentStat.wrongCount > 0);
  const currentSectionProgress = computeProgressInfo(filteredQuestions);
  const modalProgress = startModalConfig
    ? computeProgressInfo(getQuestionsForConfig(startModalConfig))
    : null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800">
      
      {/* 글로벌 네비게이션 바 */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            onClick={() => setViewMode('dashboard')}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <span className="font-extrabold text-lg text-slate-800 group-hover:text-rose-600 transition-colors">
              컴활 1급 필기 CBT
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setViewMode('dashboard')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                viewMode === 'dashboard'
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              대시보드
            </button>
            <button
              onClick={() => {
                if (viewMode === 'dashboard') {
                  handleStartSubject(selectedSubject);
                } else {
                  setFilterMode('SUBJECT');
                  setViewMode('quiz');
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                viewMode === 'quiz' && filterMode === 'SUBJECT'
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              과목별 학습
            </button>
            {examRounds.length > 0 && (
              <button
                onClick={() => {
                  const targetRound = selectedRound === 'ALL' && examRounds.length > 0
                    ? examRounds[0].id
                    : selectedRound;
                  if (viewMode === 'dashboard' && targetRound !== 'ALL') {
                    handleStartRound(targetRound);
                  } else {
                    setFilterMode('ROUND');
                    if (selectedRound === 'ALL' && examRounds.length > 0) {
                      setSelectedRound(examRounds[0].id);
                    }
                    setViewMode('quiz');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                  viewMode === 'quiz' && filterMode === 'ROUND'
                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                기출 회차별
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ======================================================== */}
      {/* 1. 메인 대시보드 화면 (Home Dashboard) */}
      {/* ======================================================== */}
      {viewMode === 'dashboard' && (
        <main className="max-w-4xl mx-auto p-4 sm:p-6 md:p-8 animate-fade-in">
          
          {/* 환영 배너 & 문제 풀기 액션 */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg mb-8 border border-slate-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <span className="inline-block bg-rose-500/30 text-rose-300 border border-rose-400/40 text-xs font-semibold px-3 py-1 rounded-full mb-3">
                  합격 대비 AI 맞춤형 학습
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-2">
                  컴활 1급 필기 완성
                </h1>
                <p className="text-slate-300 text-sm sm:text-base">
                  한 번이라도 틀린 문제는 철저한 오답 이력으로 집중 관리됩니다.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleResumeLearning}
                  className="bg-rose-500 text-white font-bold px-5 py-3 rounded-xl shadow-md hover:bg-rose-600 transition-all text-sm sm:text-base cursor-pointer"
                >
                  문제 풀기
                </button>
                {statsSummary.everWrong > 0 && (
                  <button
                    onClick={handleStartWrongReview}
                    className="bg-slate-700 hover:bg-slate-600 text-white font-bold px-4 py-3 rounded-xl border border-slate-500 text-sm transition-all cursor-pointer shadow-sm"
                  >
                    오답노트 복습 ({statsSummary.everWrong}문제)
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 종합 학습 통계 카드 4종 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-500 block mb-1">전체 진도율</span>
                <div className="text-2xl font-extrabold text-gray-800">
                  {statsSummary.progressRate}%
                </div>
                <span className="text-xs text-gray-500 mt-1 block mb-2">
                  {statsSummary.solved} / {statsSummary.total} 문제 시도
                </span>
                <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden mb-3">
                  <div
                    className="bg-rose-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${statsSummary.progressRate}%` }}
                  />
                </div>
              </div>
              <button
                onClick={handleResumeLearning}
                className="w-full bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white border border-rose-200 font-bold py-1.5 rounded-lg text-xs transition-all cursor-pointer"
              >
                문제 풀기
              </button>
            </div>

            <div className="bg-white p-5 rounded-2xl border-2 border-rose-300 bg-rose-50/20 shadow-xs">
              <span className="text-xs font-bold text-rose-600 block mb-1">오답 이력 보유</span>
              <div className="text-2xl font-extrabold text-rose-600">
                {statsSummary.everWrong}
                <span className="text-xs text-rose-400 font-normal ml-1">문제</span>
              </div>
              <span className="text-xs text-rose-500 mt-1 block font-medium">
                한 번이라도 틀렸던 문제
              </span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
              <span className="text-xs font-semibold text-gray-500 block mb-1">원샷 정답</span>
              <div className="text-2xl font-extrabold text-emerald-600">
                {statsSummary.cleanPass}
                <span className="text-xs text-gray-400 font-normal ml-1">문제</span>
              </div>
              <span className="text-xs text-emerald-600 mt-1 block font-medium">
                오답 없이 바로 맞힘
              </span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs">
              <span className="text-xs font-semibold text-gray-500 block mb-1">누적 풀이 횟수</span>
              <div className="text-2xl font-extrabold text-slate-800">
                {statsSummary.totalAttempts}
                <span className="text-xs text-gray-400 font-normal ml-1">회</span>
              </div>
              <span className="text-xs text-gray-400 mt-1 block">
                전체 답안 제출 이력
              </span>
            </div>
          </div>

          {/* 년도/회차별 기출문제 실전 풀기 (존재할 경우 표시) */}
          {examRounds.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-800">
                    년도·회차별 기출문제 실전 풀기
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    실제 출제된 60문항(1~3과목)을 시험 회차 순서대로 실전처럼 풀어보세요.
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">
                  총 {examRounds.length}개 회차 ({statsSummary.total}문항)
                </span>
              </div>

              {/* 년도 선택 탭 */}
              {availableExamYears.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 custom-scrollbar">
                  <button
                    onClick={() => setSelectedExamYear('ALL')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                      selectedExamYear === 'ALL'
                        ? 'bg-slate-800 text-white shadow-xs'
                        : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    전체 년도 ({examRounds.length}개 회차)
                  </button>
                  {availableExamYears.map(yr => {
                    const count = examRounds.filter(r => r.year === yr).length;
                    const isSel = selectedExamYear === yr;
                    return (
                      <button
                        key={yr}
                        onClick={() => setSelectedExamYear(yr)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                          isSel
                            ? 'bg-rose-500 text-white shadow-xs'
                            : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {yr} ({count}개 회차)
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {examRounds
                  .filter(rnd => selectedExamYear === 'ALL' || rnd.year === selectedExamYear)
                  .map(rnd => (
                  <div 
                    key={rnd.id}
                    className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between hover:border-slate-400 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-100">
                          {rnd.year}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {rnd.solved} / {rnd.total}문항
                        </span>
                      </div>
                      <h3 className="font-extrabold text-base text-gray-800 mb-1">{rnd.name}</h3>
                      <p className="text-xs text-gray-400 mb-3">1과목~3과목 통합 60문항</p>
                      
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                        <span>진도율 {rnd.progressRate}%</span>
                        {rnd.everWrong > 0 && (
                          <span className="font-semibold text-rose-500">오답 {rnd.everWrong}개</span>
                        )}
                      </div>
                      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mb-4">
                        <div 
                          className="bg-rose-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${rnd.progressRate}%` }}
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => handleStartRound(rnd.id)}
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer shadow-xs"
                    >
                      문제 풀기
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 과목별 학습 현황 카드 3개 */}
          <h2 className="text-lg font-bold text-gray-800 mb-4">
            과목별 집중 공략
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {subjectProgress.map(subj => (
              <div 
                key={subj.id}
                className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between hover:border-slate-400 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {subj.solved} / {subj.total}
                    </span>
                  </div>
                  <h3 className="font-bold text-base text-gray-800 mb-1">{subj.name}</h3>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>진도율 {subj.progressRate}%</span>
                    <span className="font-semibold text-rose-500">
                      오답 이력 {subj.everWrong}개
                    </span>
                  </div>
                  {/* 프로그레스 바 */}
                  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mb-4">
                    <div 
                      className="bg-rose-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${subj.progressRate}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => handleStartSubject(subj.id)}
                  className="w-full bg-slate-100 text-slate-800 hover:bg-slate-800 hover:text-white font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer"
                >
                  문제 풀기
                </button>
              </div>
            ))}
          </div>

          {/* 전체 문항 풀이 현황표 (OMR Grid) */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-800">
                  전체 {statsSummary.total}문항 풀이 진도 현황표
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  한 번이라도 틀렸던 문제는 단계별 그라데이션으로 영구 관리됩니다.
                </p>
              </div>

              {/* OMR 필터 칩 */}
              <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => setOmrFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'ALL' ? 'bg-white shadow-xs text-gray-800 font-bold' : 'text-gray-500'
                  }`}
                >
                  전체 ({statsSummary.total})
                </button>
                <button
                  onClick={() => setOmrFilter('EVER_WRONG')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'EVER_WRONG' ? 'bg-white shadow-xs text-rose-600 font-bold' : 'text-gray-500'
                  }`}
                >
                  오답 전체 ({statsSummary.everWrong})
                </button>
                <button
                  onClick={() => setOmrFilter('WRONG_1')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'WRONG_1' ? 'bg-white shadow-xs text-amber-800 font-bold' : 'text-gray-500'
                  }`}
                >
                  1회 오답 ({statsSummary.wrong1})
                </button>
                <button
                  onClick={() => setOmrFilter('WRONG_2')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'WRONG_2' ? 'bg-white shadow-xs text-orange-600 font-bold' : 'text-gray-500'
                  }`}
                >
                  2회 오답 ({statsSummary.wrong2})
                </button>
                <button
                  onClick={() => setOmrFilter('WRONG_3_PLUS')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'WRONG_3_PLUS' ? 'bg-white shadow-xs text-purple-900 font-bold' : 'text-gray-500'
                  }`}
                >
                  3회 이상 ({statsSummary.wrong3Plus})
                </button>
                <button
                  onClick={() => setOmrFilter('CLEAN_PASS')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'CLEAN_PASS' ? 'bg-white shadow-xs text-emerald-600 font-bold' : 'text-gray-500'
                  }`}
                >
                  원샷 정답 ({statsSummary.cleanPass})
                </button>
                <button
                  onClick={() => setOmrFilter('UNSOLVED')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    omrFilter === 'UNSOLVED' ? 'bg-white shadow-xs text-gray-700 font-bold' : 'text-gray-500'
                  }`}
                >
                  미풀이 ({statsSummary.unsolved})
                </button>
              </div>
            </div>

            {/* 오답 횟수 그라데이션 범례 */}
            <div className="flex flex-wrap items-center gap-3.5 text-xs text-gray-600 mb-4 pb-3 border-b border-gray-100">
              <span className="font-bold text-gray-800">오답 단계:</span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-md bg-gray-100 border border-gray-300 inline-block" /> 미풀이
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-md bg-emerald-500 inline-block" /> 0회 (원샷 정답)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-md bg-amber-300 border border-amber-400 inline-block" /> 1회 오답
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-md bg-orange-500 inline-block" /> 2회 오답
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-md bg-rose-600 inline-block" /> 3회 오답
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-md bg-purple-900 border border-rose-400 inline-block" /> 4회 이상
              </span>
              <span className="flex items-center gap-1 sm:ml-auto text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full ring-2 ring-emerald-400 inline-block mr-0.5" /> 초록 테두리: 현재 재도전 정답 성공
              </span>
            </div>

            {/* 그리드 */}
            <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-15 gap-1.5 max-h-[400px] overflow-y-auto p-1 custom-scrollbar">
              {questions.map((q, idx) => {
                const st = userStatsMap[q.id];
                const heatmap = getWrongHeatmapStyle(st);
                const isEverWrong = st && st.wrongCount > 0;
                const isCleanPass = st && st.wrongCount === 0 && st.tryCount > 0;
                const isUnsolved = !st || st.tryCount === 0;

                if (omrFilter === 'EVER_WRONG' && !isEverWrong) return null;
                if (omrFilter === 'WRONG_1' && st?.wrongCount !== 1) return null;
                if (omrFilter === 'WRONG_2' && st?.wrongCount !== 2) return null;
                if (omrFilter === 'WRONG_3_PLUS' && (st?.wrongCount || 0) < 3) return null;
                if (omrFilter === 'CLEAN_PASS' && !isCleanPass) return null;
                if (omrFilter === 'UNSOLVED' && !isUnsolved) return null;

                return (
                  <button
                    key={q.id}
                    onClick={() => handleJumpToSpecificQuestion(q.id)}
                    className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center transition-all cursor-pointer ${heatmap.chip}`}
                    title={`${idx + 1}번: ${q.category} (${heatmap.text})`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 대시보드: AI 튜터 질문·답변 보관함 */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs mb-8">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">
                  AI 튜터 질문·답변 이력 ({allConversationPairs.length}건)
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  문제를 풀면서 AI 튜터에게 질문했던 내역을 다시 확인하거나 삭제할 수 있습니다.
                </p>
              </div>
            </div>

            {allConversationPairs.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100 text-xs text-gray-500">
                아직 AI 튜터에게 질문한 이력이 없습니다. 문제 해설 하단의 AI 튜터에게 궁금한 점을 질문해보세요.
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                {allConversationPairs.map((pair) => {
                  const qIdx = questions.findIndex(q => q.id === pair.questionId);
                  const qObj = qIdx !== -1 ? questions[qIdx] : null;
                  return (
                    <div
                      key={`${pair.questionId}-${pair.id}`}
                      className="bg-slate-50 border border-slate-200 rounded-xl p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-200/80">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleJumpToSpecificQuestion(pair.questionId)}
                            className="text-xs font-extrabold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            {qIdx !== -1 ? `${qIdx + 1}번 문제로 이동` : `문제 #${pair.questionId}`}
                          </button>
                          {qObj && (
                            <span className="text-xs text-gray-500 truncate max-w-xs sm:max-w-md">
                              {qObj.category}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {pair.createdAt && (
                            <span className="text-[11px] text-gray-400">
                              {new Date(pair.createdAt).toLocaleDateString()}{' '}
                              {new Date(pair.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <button
                            onClick={() => handleDeleteConversationPair(pair)}
                            className="text-xs text-gray-500 hover:text-rose-600 bg-white hover:bg-rose-50 border border-gray-200 hover:border-rose-200 px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer"
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {pair.userMessage && (
                        <div className="mb-2.5 text-xs sm:text-sm font-bold text-slate-800 bg-white px-3.5 py-2.5 rounded-lg border border-slate-200">
                          <span className="text-rose-500 mr-1.5">Q.</span>
                          {pair.userMessage.content}
                        </div>
                      )}

                      {pair.tutorMessage && (
                        <div className="bg-white p-3.5 rounded-lg border border-rose-100 text-xs sm:text-sm leading-relaxed text-gray-700 prose prose-sm prose-rose max-w-none">
                          <span className="font-bold text-rose-500 block mb-1.5 text-xs">
                            AI 튜터 답변
                          </span>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {pair.tutorMessage.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </main>
      )}

      {/* ======================================================== */}
      {/* 2. 문제 풀이 화면 (Quiz Solving View) */}
      {/* ======================================================== */}
      {viewMode === 'quiz' && (
        <main className="max-w-3xl mx-auto p-4 md:p-8 animate-fade-in">
          
          {/* 상단 컨트롤 바 */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('dashboard')}
                className="text-xs font-bold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-xl shadow-2xs flex items-center gap-1 cursor-pointer"
              >
                대시보드
              </button>
              
              {/* 오답노트 모드 토글 뱃지 */}
              {onlyWrongMode && (
                <span className="bg-rose-100 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-2xs border border-rose-200">
                  오답노트 모드 (틀린 문제만)
                  <button 
                    onClick={() => setOnlyWrongMode(false)}
                    className="hover:text-rose-950 ml-1 font-extrabold cursor-pointer"
                    title="오답노트 해제"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRandomQuestion}
                className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-slate-50 hover:border-slate-400 transition-colors shadow-2xs cursor-pointer"
                title="무작위 문제 풀기"
              >
                랜덤 문제
              </button>

              {filteredQuestions.length > 0 && (
                <div className="relative">
                  <select
                    value={currentIndex}
                    onChange={(e) => handleJumpToIndex(Number(e.target.value))}
                    className="bg-white border border-gray-300 text-gray-800 px-3 py-1.5 rounded-xl text-xs font-bold shadow-2xs cursor-pointer hover:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    {filteredQuestions.map((_, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1} / {filteredQuestions.length}번
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* 학습 방식 모드 선택 바 (과목별 집중 학습 vs 년도·회차별 기출 풀기) */}
          <div className="bg-slate-200/80 p-1 rounded-2xl flex gap-1 mb-5">
            <button
              onClick={() => {
                setFilterMode('SUBJECT');
                setCurrentIndex(0);
                handleResetCurrentSession();
              }}
              className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer text-center ${
                filterMode === 'SUBJECT'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              [과목별 집중 학습]
            </button>
            {examRounds.length > 0 && (
              <button
                onClick={() => {
                  setFilterMode('ROUND');
                  if (selectedRound === 'ALL' && examRounds.length > 0) {
                    setSelectedRound(examRounds[0].id);
                  }
                  setCurrentIndex(0);
                  handleResetCurrentSession();
                }}
                className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer text-center ${
                  filterMode === 'ROUND'
                    ? 'bg-white text-rose-600 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                [년도·회차별 기출 풀기] ({examRounds.length}개 회차)
              </button>
            )}
          </div>

          {/* 1. 과목별 모드 선택 탭 & 단원 필터 */}
          {filterMode === 'SUBJECT' && (
            <>
              {/* 과목 탭 */}
              <div className="mb-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {subjects.map((subj) => {
                    const isSelected = selectedSubject === subj.id;
                    const count = subjectCounts[subj.id] || 0;
                    return (
                      <button
                        key={subj.id}
                        onClick={() => handleSelectSubject(subj.id)}
                        className={`flex flex-col items-center justify-center p-2.5 sm:p-3 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-rose-500 border-rose-500 text-white shadow-sm'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-rose-50 hover:border-rose-200'
                        }`}
                      >
                        <span className="truncate w-full text-center">{subj.name}</span>
                        <span className={`text-[11px] font-normal mt-0.5 px-2 py-0.2 rounded-full ${
                          isSelected ? 'bg-rose-600/50 text-white' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {count}문항
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 세부 단원 필터 칩 */}
              {subCategories.length > 0 && (
                <div className="mb-6 bg-white p-3 rounded-xl border border-gray-200 shadow-2xs">
                  <div className="text-xs font-bold text-gray-500 mb-2 flex items-center justify-between">
                    <span>세부 단원 필터</span>
                    {selectedSubCategory !== 'ALL' && (
                      <button
                        onClick={() => handleSelectSubCategory('ALL')}
                        className="text-rose-500 hover:underline font-semibold cursor-pointer"
                      >
                        단원 필터 해제
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                    <button
                      onClick={() => handleSelectSubCategory('ALL')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        selectedSubCategory === 'ALL'
                          ? 'bg-slate-800 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      전체 단원 ({subjectCounts[selectedSubject] || questions.length})
                    </button>
                    {subCategories.map((sub) => {
                      const isSelected = selectedSubCategory === sub.name;
                      return (
                        <button
                          key={sub.name}
                          onClick={() => handleSelectSubCategory(sub.name)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-slate-800 text-white shadow-2xs'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {sub.name} <span className="text-[10px] opacity-75">({sub.count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 2. 년도/회차별 모드 선택 탭 & 과목 점프 필터 */}
          {filterMode === 'ROUND' && (
            <div className="mb-6 space-y-3">
              {/* 회차 선택 탭 (년도별 + 회차별 2단계 필터) */}
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-gray-600">
                  <span>기출문제 년도 및 회차 선택</span>
                  <span className="text-[11px] text-gray-400 font-normal">회차당 60문항 실전 구성</span>
                </div>

                {/* 1단계: 년도 선택 */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                  <button
                    onClick={() => {
                      setSelectedExamYear('ALL');
                      setSelectedRound('ALL');
                      setCurrentIndex(0);
                      handleResetCurrentSession();
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                      selectedExamYear === 'ALL'
                        ? 'bg-slate-800 text-white shadow-xs'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    전체 년도
                  </button>
                  {availableExamYears.map((yr) => {
                    const isSel = selectedExamYear === yr;
                    return (
                      <button
                        key={yr}
                        onClick={() => {
                          setSelectedExamYear(yr);
                          const yearRounds = examRounds.filter(r => r.year === yr);
                          if (yearRounds.length > 0) {
                            setSelectedRound(yearRounds[0].id);
                          }
                          setCurrentIndex(0);
                          handleResetCurrentSession();
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                          isSel
                            ? 'bg-slate-800 text-white shadow-xs'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {yr}
                      </button>
                    );
                  })}
                </div>

                {/* 2단계: 회차 선택 */}
                <div className="flex gap-2 overflow-x-auto pb-1 border-t border-gray-100 pt-2 custom-scrollbar">
                  <button
                    onClick={() => {
                      setSelectedRound('ALL');
                      setCurrentIndex(0);
                      handleResetCurrentSession();
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                      selectedRound === 'ALL'
                        ? 'bg-rose-500 text-white shadow-xs'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {selectedExamYear === 'ALL' ? '전체 회차' : `${selectedExamYear} 전체`} ({examRounds.filter(r => selectedExamYear === 'ALL' || r.year === selectedExamYear).reduce((acc, r) => acc + r.total, 0)}문항)
                  </button>
                  {examRounds
                    .filter((rnd) => selectedExamYear === 'ALL' || rnd.year === selectedExamYear)
                    .map((rnd) => {
                      const isSelected = selectedRound === rnd.id;
                      return (
                        <button
                          key={rnd.id}
                          onClick={() => {
                            if (rnd.solved > 0) {
                              handleStartRound(rnd.id);
                            } else {
                              setSelectedRound(rnd.id);
                              setCurrentIndex(0);
                              handleResetCurrentSession();
                            }
                          }}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-rose-500 text-white shadow-xs'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {rnd.id} ({rnd.total}문항)
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* 회차 내 과목 점프 필터 */}
              <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-2xs">
                <div className="text-xs font-bold text-gray-600 mb-2">과목별 구간 이동</div>
                <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                  {[
                    { id: 'ALL', name: '전과목 (1~60번)' },
                    { id: '컴퓨터 일반', name: '1과목 컴퓨터 일반 (1~20번)' },
                    { id: '스프레드시트 일반', name: '2과목 스프레드시트 (21~40번)' },
                    { id: '데이터베이스 일반', name: '3과목 데이터베이스 (41~60번)' },
                  ].map((s) => {
                    const isSel = selectedRoundSubject === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedRoundSubject(s.id);
                          setCurrentIndex(0);
                          handleResetCurrentSession();
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                          isSel
                            ? 'bg-slate-800 text-white shadow-2xs'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 현재 선택 구간 진도율 및 빠른 위치 이동 바 */}
          {filteredQuestions.length > 0 && (
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-2xs mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-bold text-gray-700">
                    현재 구간 진도율 <span className="text-rose-600 font-extrabold">{currentSectionProgress.progressRate}%</span>
                  </span>
                  <span className="text-gray-500 font-semibold">
                    {currentSectionProgress.solved} / {currentSectionProgress.total}문항 완료
                  </span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-rose-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${currentSectionProgress.progressRate}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleJumpToIndex(0)}
                  disabled={currentIndex === 0}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  처음부터 (1번)
                </button>
                <button
                  onClick={() => handleJumpToIndex(currentSectionProgress.resumeIdx)}
                  disabled={currentIndex === currentSectionProgress.resumeIdx}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  진도 이어서 ({currentSectionProgress.resumeIdx + 1}번)
                </button>
              </div>
            </div>
          )}

          {/* 문제 카드 본체 */}
          {filteredQuestions.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-12 mb-6 border border-gray-200 text-center">
              <h2 className="text-xl font-bold text-gray-800 mb-2">선택한 조건에 해당하는 문제가 없습니다.</h2>
              <p className="text-gray-500 text-sm mb-4">
                {onlyWrongMode ? '현재 조건에서 틀린 이력이 있는 문제가 없습니다.' : '다른 카테고리나 단원을 선택해보세요.'}
              </p>
              <button
                onClick={() => {
                  setOnlyWrongMode(false);
                  handleSelectSubject('ALL');
                }}
                className="bg-rose-500 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-rose-600 cursor-pointer"
              >
                전체 문제 보기
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8 mb-6 border border-gray-200">
              
              {/* 상단 메타 정보 (카테고리 & 오답 이력 알림 뱃지) */}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-gray-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-100">
                    {currentQ.category.split(' > ')[0] || currentQ.category}
                  </span>
                  {currentQ.category.includes(' > ') && (
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
                      {currentQ.category.split(' > ')[1]}
                    </span>
                  )}
                  {filterMode === 'ROUND' && selectedRound !== 'ALL' && (
                    <span className="text-xs font-bold text-slate-700 bg-slate-100 border border-slate-300 px-2.5 py-1 rounded-md">
                      {selectedRound} 실전
                    </span>
                  )}
                </div>

                {/* 오답 이력 뱃지 (틀린 횟수 그라데이션 반영) */}
                {hasWrongHistory ? (
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs border ${getWrongHeatmapStyle(currentStat).badge}`}>
                      <span>누적 오답: {currentStat.wrongCount}회 기록</span>
                    </span>
                    {currentStat.isCorrect && (
                      <span className="bg-emerald-100 text-emerald-800 text-xs font-extrabold px-2.5 py-1 rounded-full border border-emerald-200">
                        이전 정답 이력 있음
                      </span>
                    )}
                  </div>
                ) : currentStat && currentStat.tryCount > 0 ? (
                  <span className="bg-emerald-100 text-emerald-700 text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1 border border-emerald-200">
                    원샷 정답 (오답 0회)
                  </span>
                ) : (
                  <span className="bg-gray-100 text-gray-500 text-xs font-semibold px-2.5 py-1 rounded-full">
                    미풀이 문항
                  </span>
                )}
              </div>

              {/* 문제 본문 */}
              <h2 className="text-lg md:text-xl font-bold leading-relaxed whitespace-pre-wrap mb-6 text-gray-900">
                <span className="text-rose-500 mr-2">Q{currentIndex + 1}.</span>
                {parsedPassage ? parsedPassage.questionText : currentQ.passage}
              </h2>

              {/* 4지선다 인터랙티브 보기 카드들 */}
              {parsedPassage && parsedPassage.options.length > 0 ? (
                <div className="space-y-3 mb-6">
                  {parsedPassage.options.map((opt) => {
                    const isSelectedInSession = currentSessionAnswer === opt.label;
                    const isCorrectAnswer = currentQ.answer === opt.label;

                    let cardStyle = 'border-gray-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-gray-800';
                    let badgeText = null;
                    let badgeStyle = '';

                    if (hasSessionAnswered) {
                      if (isCorrectAnswer) {
                        cardStyle = 'border-emerald-500 bg-emerald-50 text-emerald-950 font-medium ring-2 ring-emerald-400';
                        badgeText = isSelectedInSession ? '내가 맞힌 정답' : '정답';
                        badgeStyle = 'bg-emerald-600 text-white';
                      } else if (isSelectedInSession) {
                        cardStyle = 'border-rose-500 bg-rose-50 text-rose-950 font-medium ring-2 ring-rose-400';
                        badgeText = '내가 고른 오답';
                        badgeStyle = 'bg-rose-600 text-white';
                      } else {
                        cardStyle = 'border-gray-200 bg-gray-50/50 text-gray-400 opacity-60';
                      }
                    }

                    return (
                      <button
                        key={opt.label}
                        disabled={isSubmitting || hasSessionAnswered}
                        onClick={() => handleSelectOption(opt.label)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3.5 cursor-pointer ${cardStyle}`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          hasSessionAnswered && isCorrectAnswer ? 'bg-emerald-600 text-white' :
                          hasSessionAnswered && isSelectedInSession ? 'bg-rose-600 text-white' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {opt.label}
                        </span>
                        <div className="flex-1 text-sm md:text-base leading-relaxed pt-0.5">
                          {opt.text}
                        </div>
                        {badgeText && (
                          <span className={`text-xs px-2.5 py-1 rounded-full font-bold shrink-0 ${badgeStyle}`}>
                            {badgeText}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-base mb-6 text-gray-700">
                  {currentQ.passage}
                </div>
              )}

              {/* 보조 버튼 (정답 바로보기, 이전 AI 질문 이력 보기 & 다시 풀기) */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
                <div className="flex flex-wrap items-center gap-3">
                  {!hasSessionAnswered && !showAnswer && (
                    <button 
                      onClick={() => setShowAnswer(true)}
                      className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
                    >
                      정답 및 해설 바로 보기
                    </button>
                  )}
                  {!hasSessionAnswered && !showAnswer && currentConversationPairs.length > 0 && (
                    <button
                      onClick={() => setShowAiHistoryOnCard(prev => !prev)}
                      className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg font-bold hover:bg-rose-100 cursor-pointer transition-colors"
                    >
                      {showAiHistoryOnCard
                        ? 'AI 질문·답변 이력 닫기'
                        : `저장된 AI 질문·답변 이력 보기 (${currentConversationPairs.length}건)`}
                    </button>
                  )}
                </div>

                {(hasSessionAnswered || showAnswer) && (
                  <button
                    onClick={handleResetCurrentSession}
                    className="text-xs text-gray-600 hover:text-rose-600 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    이 문제 다시 풀어보기
                  </button>
                )}
              </div>

              {/* 풀이 전이라도 이전 AI 질문 이력 보기 토글이 켜진 경우 표시 */}
              {!hasSessionAnswered && !showAnswer && showAiHistoryOnCard && currentConversationPairs.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 animate-fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-700">
                      이 문제의 AI 질문·답변 이력 ({currentConversationPairs.length}건)
                    </span>
                    <button
                      onClick={() => handleClearQuestionConversations(currentQ.id)}
                      className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      이 문제 질문 이력 전체 삭제
                    </button>
                  </div>
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
                    {currentConversationPairs.map((pair) => (
                      <div key={pair.id} className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="text-xs sm:text-sm font-bold text-slate-800">
                            <span className="text-rose-500 mr-1.5">Q.</span>
                            {pair.userMessage ? pair.userMessage.content : '(질문 내역)'}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {pair.createdAt && (
                              <span className="text-[11px] text-gray-400">
                                {new Date(pair.createdAt).toLocaleDateString()}{' '}
                                {new Date(pair.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                            <button
                              onClick={() => handleDeleteConversationPair(pair)}
                              className="text-xs text-gray-400 hover:text-rose-600 font-bold px-2 py-0.5 rounded border border-gray-200 hover:border-rose-200 cursor-pointer transition-colors"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                        {pair.tutorMessage && (
                          <div className="bg-rose-50/30 border border-rose-100 rounded-lg p-3 text-xs sm:text-sm text-gray-700 prose prose-sm prose-rose max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {pair.tutorMessage.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 나의 풀이 이력 타임라인 (Submission Logs) */}
              {currentAttempts && currentAttempts.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-2.5">
                    <span>
                      나의 풀이 이력 ({currentAttempts.length}회 시도)
                    </span>
                    {hasWrongHistory && (
                      <span className="text-rose-600 font-bold">누적 오답: {currentStat.wrongCount}회</span>
                    )}
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                    {currentAttempts.map((attempt, attIdx) => {
                      const correct = isLogCorrect(attempt);
                      return (
                        <div 
                          key={attempt.id || attIdx}
                          className={`text-xs px-3 py-2 rounded-lg flex items-center justify-between border ${
                            correct 
                              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900 font-medium' 
                              : 'bg-rose-50/80 border-rose-200 text-rose-900 font-medium'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              correct ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                            }`}>
                              {correct ? '정답' : '오답'}
                            </span>
                            <span className="font-bold">{currentAttempts.length - attIdx}회차:</span>
                            <span>선택한 답 [<strong>{attempt.selectedAnswer}</strong>]</span>
                            <span className="text-[11px] opacity-80">
                              ({correct ? '정답' : `실제 정답: ${attempt.correctAnswer}`})
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-400">
                            {new Date(attempt.createdAt).toLocaleDateString()} {new Date(attempt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 정답 및 해설 섹션 */}
              {(hasSessionAnswered || showAnswer) && (
                <div className="animate-fade-in border-t border-gray-100 pt-6">
                  
                  {/* 채점 피드백 배너 */}
                  {hasSessionAnswered && currentSessionResult && (
                    <div className={`p-4 rounded-xl mb-5 flex items-center gap-3 ${
                      currentSessionResult.isCorrect 
                        ? hasWrongHistory
                          ? 'bg-amber-50 border border-amber-300 text-amber-900'
                          : 'bg-emerald-100 border border-emerald-300 text-emerald-900' 
                        : 'bg-rose-100 border border-rose-300 text-rose-900'
                    }`}>
                      <div>
                        <p className="font-extrabold text-sm sm:text-base">
                          {currentSessionResult.isCorrect 
                            ? hasWrongHistory 
                              ? '이번 시도에서 정답을 맞히셨습니다. (과거 오답 이력은 안전하게 보존됩니다)' 
                              : '정답입니다. 오답 없이 한 번에 맞히셨습니다.'
                            : '오답입니다. 이번 시도는 오답 이력으로 등록되었습니다.'}
                        </p>
                        <p className="text-xs opacity-90 mt-0.5">
                          {currentSessionResult.isCorrect 
                            ? '개념이 머릿속에 확실히 정리되었습니다.' 
                            : '해설을 확인하고, 헷갈리는 부분은 아래 AI 튜터에게 질문해보세요.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 정답 & 기본 해설 */}
                  <div className="bg-green-50/70 border border-green-200 rounded-xl p-5 mb-6">
                    <p className="text-base mb-2">
                      <span className="font-bold text-green-800">정답:</span>{' '}
                      <span className="font-extrabold text-green-700 bg-green-100 px-2 py-0.5 rounded-md">
                        {currentQ.answer}
                      </span>
                    </p>
                    <p className="text-gray-700 text-sm md:text-base whitespace-pre-wrap leading-relaxed">
                      <span className="font-bold text-green-800 block mb-1">해설:</span>
                      {currentQ.explanation}
                    </p>
                  </div>

                  {/* 제미나이 질의 및 대화 이력 섹션 */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 md:p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-slate-700 text-sm md:text-base">
                        AI 튜터에게 질문하기
                      </h3>
                      {currentConversationPairs.length > 0 && (
                        <button
                          onClick={() => handleClearQuestionConversations(currentQ.id)}
                          className="text-xs text-gray-500 hover:text-rose-600 font-bold hover:underline cursor-pointer"
                        >
                          이 문제 질문 이력 전체 삭제
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2 mb-4">
                      <input 
                        type="text" 
                        value={askQuery}
                        onChange={(e) => setAskQuery(e.target.value)}
                        placeholder="예: 내가 고른 보기는 왜 정답이 될 수 없어?" 
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 text-sm bg-white"
                        onKeyDown={(e) => e.key === 'Enter' && handleAskGemini()}
                      />
                      <button 
                        onClick={handleAskGemini}
                        disabled={isAsking}
                        className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold hover:bg-slate-700 disabled:opacity-50 text-sm whitespace-nowrap cursor-pointer transition-colors"
                      >
                        {isAsking ? '답변중...' : '물어보기'}
                      </button>
                    </div>

                    {/* 실시간 스트리밍 중인 답변 표시 */}
                    {geminiResponse && (
                      <div className="bg-white p-5 rounded-xl border border-rose-200 text-sm leading-relaxed text-gray-700 shadow-inner max-h-[500px] overflow-y-auto custom-scrollbar mb-4">
                        <span className="font-bold text-rose-500 block mb-3 sticky top-0 bg-white pb-2 border-b border-gray-100 z-10">
                          AI 튜터 실시간 답변
                        </span>
                        <div className="prose prose-sm prose-rose max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {geminiResponse}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {/* 저장된 나의 AI 질문·답변 이력 목록 */}
                    {currentConversationPairs.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-200">
                        <div className="text-xs font-bold text-slate-600 mb-3">
                          나의 AI 질문·답변 이력 ({currentConversationPairs.length}건)
                        </div>
                        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                          {currentConversationPairs.map((pair) => (
                            <div
                              key={pair.id}
                              className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs"
                            >
                              <div className="flex items-start justify-between gap-2 mb-2.5 pb-2 border-b border-gray-100">
                                <div className="text-xs sm:text-sm font-bold text-slate-800">
                                  <span className="text-rose-500 mr-1.5">Q.</span>
                                  {pair.userMessage ? pair.userMessage.content : '(질문)'}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {pair.createdAt && (
                                    <span className="text-[11px] text-gray-400">
                                      {new Date(pair.createdAt).toLocaleDateString()}{' '}
                                      {new Date(pair.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => handleDeleteConversationPair(pair)}
                                    className="text-xs text-gray-500 hover:text-rose-600 bg-gray-50 hover:bg-rose-50 border border-gray-200 hover:border-rose-200 px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer"
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                              {pair.tutorMessage && (
                                <div className="text-xs sm:text-sm leading-relaxed text-gray-700 prose prose-sm prose-rose max-w-none">
                                  <span className="font-bold text-rose-500 block mb-1 text-xs">
                                    AI 튜터 답변
                                  </span>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {pair.tutorMessage.content}
                                  </ReactMarkdown>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              )}

            </div>
          )}

          {/* 하단 네비게이션 버튼 (이전 / 다음) */}
          {filteredQuestions.length > 0 && (
            <div className="flex justify-between gap-4">
              <button 
                onClick={prevQuestion}
                disabled={currentIndex === 0}
                className="flex-1 bg-white border border-gray-200 font-bold py-3.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-2xs cursor-pointer text-sm"
              >
                이전 문제
              </button>
              <button 
                onClick={nextQuestion}
                disabled={currentIndex === filteredQuestions.length - 1}
                className="flex-1 bg-white border border-gray-200 font-bold py-3.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-2xs cursor-pointer text-sm"
              >
                다음 문제
              </button>
            </div>
          )}

        </main>
      )}

      {/* ======================================================== */}
      {/* 3. 문제 풀기 시작 위치 선택 모달 (처음부터 vs 진도 이어서) */}
      {/* ======================================================== */}
      {startModalConfig && modalProgress && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in"
          onClick={() => setStartModalConfig(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-200 p-6 sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                {startModalConfig.subtitle && (
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100 mb-1.5">
                    {startModalConfig.subtitle}
                  </span>
                )}
                <h3 className="text-xl font-extrabold text-gray-900">
                  {startModalConfig.title}
                </h3>
              </div>
              <button
                onClick={() => setStartModalConfig(null)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none px-1.5 py-0.5 cursor-pointer"
                title="닫기"
              >
                ×
              </button>
            </div>

            {/* 현재 진도율 요약 카드 */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-5">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-1.5">
                <span>현재 진도율 <strong className="text-rose-600 text-sm">{modalProgress.progressRate}%</strong></span>
                <span>{modalProgress.solved} / {modalProgress.total}문항 완료</span>
              </div>
              <div className="w-full bg-gray-200 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-rose-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${modalProgress.progressRate}%` }}
                />
              </div>
            </div>

            <p className="text-sm font-bold text-gray-700 mb-3.5">
              처음부터 푸시겠습니까, 아니면 진도를 이어서 진행하시겠습니까?
            </p>

            {/* 선택지 버튼 목록 */}
            <div className="space-y-2.5 mb-5">
              {/* 1. 진도 이어서 진행하기 */}
              <button
                onClick={() => handleConfirmStartQuiz(modalProgress.resumeIdx)}
                className="w-full text-left p-4 rounded-2xl border-2 border-rose-500 bg-rose-50/70 hover:bg-rose-500 hover:text-white group transition-all cursor-pointer shadow-xs"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-extrabold text-sm sm:text-base text-rose-700 group-hover:text-white">
                    진도 이어서 풀기
                  </span>
                  <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-rose-500 text-white group-hover:bg-white group-hover:text-rose-600 transition-colors">
                    {modalProgress.resumeIdx + 1}번 문제부터
                  </span>
                </div>
                <p className="text-xs text-rose-800/80 group-hover:text-rose-100">
                  {modalProgress.solved === 0
                    ? '아직 풀이한 문항이 없어 1번 문제(Q1)부터 시작합니다.'
                    : modalProgress.firstUnsolvedIdx !== -1
                    ? `아직 풀지 않은 ${modalProgress.resumeIdx + 1}번 문제(Q${modalProgress.resumeIdx + 1})부터 이어서 풉니다.`
                    : '모든 문항을 풀이 완료하여 1번 문제(Q1)부터 다시 시작합니다.'}
                </p>
              </button>

              {/* 마지막 푼 문제 다음 번호가 첫 미풀이 번호와 다를 경우 추가 선택지 제공 */}
              {modalProgress.nextAfterLastIdx !== -1 &&
                modalProgress.nextAfterLastIdx !== modalProgress.resumeIdx && (
                  <button
                    onClick={() => handleConfirmStartQuiz(modalProgress.nextAfterLastIdx)}
                    className="w-full text-left p-4 rounded-2xl border-2 border-amber-400 bg-amber-50/60 hover:bg-amber-500 hover:text-white group transition-all cursor-pointer shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-extrabold text-sm sm:text-base text-amber-900 group-hover:text-white">
                        마지막 풀이 다음 문제부터 풀기
                      </span>
                      <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-amber-500 text-white group-hover:bg-white group-hover:text-amber-700 transition-colors">
                        {modalProgress.nextAfterLastIdx + 1}번 문제부터
                      </span>
                    </div>
                    <p className="text-xs text-amber-800/80 group-hover:text-amber-50">
                      최근 풀이한 문항 이후의 {modalProgress.nextAfterLastIdx + 1}번 문제(Q{modalProgress.nextAfterLastIdx + 1})부터 이어서 풉니다.
                    </p>
                  </button>
                )}

              {/* 2. 처음부터 풀기 */}
              <button
                onClick={() => handleConfirmStartQuiz(0)}
                className="w-full text-left p-4 rounded-2xl border-2 border-gray-200 bg-white hover:border-slate-800 hover:bg-slate-800 hover:text-white group transition-all cursor-pointer shadow-2xs"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-extrabold text-sm sm:text-base text-gray-800 group-hover:text-white">
                    처음부터 풀기
                  </span>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 group-hover:bg-slate-700 group-hover:text-white transition-colors">
                    1번 문제부터
                  </span>
                </div>
                <p className="text-xs text-gray-500 group-hover:text-slate-300">
                  첫 번째 문항(Q1)부터 순서대로 새로 풀이를 시작합니다.
                </p>
              </button>
            </div>

            {/* 닫기 버튼 */}
            <button
              onClick={() => setStartModalConfig(null)}
              className="w-full py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              취소
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
