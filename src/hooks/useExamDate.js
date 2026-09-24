import { useEffect, useMemo, useState } from 'react'
import { getExamSetting, setExamSetting, EXAM_DATE_EVENT } from '../lib/examDate.js'
import { resolveExamDate, examSessionLabel, daysUntil } from '../lib/nextJLPT.js'

export function useExamDate() {
  const [setting, refresh] = useState(getExamSetting)

  useEffect(() => {
    const onChange = () => refresh(getExamSetting())
    window.addEventListener(EXAM_DATE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EXAM_DATE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  return useMemo(() => {
    const nextExam = resolveExamDate(setting)
    return {
      setting,
      setSetting: (s) => { setExamSetting(s); refresh(s) },
      nextExam,
      daysToExam: daysUntil(nextExam),
      examLabel: examSessionLabel(setting),
    }
  }, [setting])
}
