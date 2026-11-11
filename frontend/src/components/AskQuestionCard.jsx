import React, { useMemo, useState } from 'react';
import './AskQuestionCard.css';

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function normalizeQuestions(request) {
  if (!request) return [];
  if (Array.isArray(request.questions) && request.questions.length > 0) {
    return request.questions.map((q, idx) => ({
      id: q.id || `q${idx + 1}`,
      question: q.question || 'Please clarify:',
      header: q.header || '',
      multi: Boolean(q.multi),
      recommended: typeof q.recommended === 'number' && q.recommended >= 0 ? q.recommended : null,
      options: (Array.isArray(q.options) ? q.options : [])
        .map((opt) => {
          if (typeof opt === 'string') {
            const label = opt.trim();
            return label ? { label, description: '', preview: '' } : null;
          }
          if (opt && typeof opt === 'object') {
            const label = String(opt.label || opt.name || opt.value || '').trim();
            return label
              ? {
                  label,
                  description: String(opt.description || opt.desc || '').trim(),
                  preview: String(opt.preview || '').trim(),
                }
              : null;
          }
          return null;
        })
        .filter(Boolean),
    }));
  }

  const rawOptions = Array.isArray(request.options) ? request.options : [];
  const options = rawOptions
    .map((opt) => {
      if (typeof opt === 'string') {
        const label = opt.trim();
        return label ? { label, description: '', preview: '' } : null;
      }
      if (opt && typeof opt === 'object') {
        const label = String(opt.label || opt.name || '').trim();
        return label
          ? {
              label,
              description: String(opt.description || '').trim(),
              preview: String(opt.preview || '').trim(),
            }
          : null;
      }
      return null;
    })
    .filter(Boolean);

  return [
    {
      id: 'q1',
      question: request.question || 'Please clarify:',
      header: request.header || '',
      multi: Boolean(request.multi),
      recommended: typeof request.recommended === 'number' ? request.recommended : null,
      options,
    },
  ];
}

export default function AskQuestionCard({ request, onSubmit, onChatInstead }) {
  const questions = useMemo(() => normalizeQuestions(request), [request]);
  const [answersByQId, setAnswersByQId] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!request || questions.length === 0) return null;

  const getAnswer = (qId) =>
    answersByQId[qId] || { selectedOptions: [], useOther: false, customInput: '' };

  const isQuestionAnswered = (q) => {
    const ans = getAnswer(q.id);
    const hasCustom = ans.useOther && ans.customInput.trim().length > 0;
    const hasSelected = ans.selectedOptions.length > 0;
    if (q.options.length === 0) {
      return ans.customInput.trim().length > 0;
    }
    return hasSelected || hasCustom;
  };

  const answeredCount = questions.filter(isQuestionAnswered).length;
  const allAnswered = questions.every(isQuestionAnswered);

  const handleToggleOption = (q, label) => {
    setAnswersByQId((prev) => {
      const current = prev[q.id] || { selectedOptions: [], useOther: false, customInput: '' };
      if (q.multi) {
        const exists = current.selectedOptions.includes(label);
        const nextSelected = exists
          ? current.selectedOptions.filter((item) => item !== label)
          : [...current.selectedOptions, label];
        return {
          ...prev,
          [q.id]: { ...current, selectedOptions: nextSelected },
        };
      }
      const alreadyPicked = current.selectedOptions[0] === label && !current.useOther;
      return {
        ...prev,
        [q.id]: {
          selectedOptions: alreadyPicked ? [] : [label],
          useOther: false,
          customInput: current.customInput,
        },
      };
    });
  };

  const handleToggleOther = (q) => {
    setAnswersByQId((prev) => {
      const current = prev[q.id] || { selectedOptions: [], useOther: false, customInput: '' };
      return {
        ...prev,
        [q.id]: {
          selectedOptions: q.multi ? current.selectedOptions : [],
          useOther: !current.useOther,
          customInput: current.customInput,
        },
      };
    });
  };

  const handleCustomTextChange = (q, text) => {
    setAnswersByQId((prev) => {
      const current = prev[q.id] || { selectedOptions: [], useOther: true, customInput: '' };
      return {
        ...prev,
        [q.id]: {
          ...current,
          useOther: true,
          selectedOptions: q.multi ? current.selectedOptions : [],
          customInput: text,
        },
      };
    });
  };

  const handleSubmitAll = (e) => {
    e?.preventDefault?.();
    if (!allAnswered || isSubmitting) return;
    setIsSubmitting(true);

    const answers = {};
    for (const q of questions) {
      const entry = getAnswer(q.id);
      const custom = (q.options.length === 0 || entry.useOther) && entry.customInput.trim()
        ? entry.customInput.trim()
        : undefined;
      answers[q.id] = {
        selectedOptions: entry.selectedOptions,
        ...(custom ? { customInput: custom } : {}),
      };
    }

    onSubmit?.(request.id, { kind: 'submit', answers }, questions);
  };

  const handleChatInsteadClick = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    onChatInstead?.(request.id);
  };

  return (
    <form className="ask-card" onSubmit={handleSubmitAll}>
      <div className="ask-card__header">
        <span className="ask-card__title">
          {questions.length === 1 ? 'Clarification' : `Questions (${questions.length})`}
        </span>
        <span className={`ask-card__progress ${allAnswered ? 'ask-card__progress--ready' : ''}`}>
          {answeredCount} / {questions.length} answered
        </span>
      </div>

      <div className="ask-card__body">
        {questions.map((q, qIdx) => {
          const answer = getAnswer(q.id);
          const selectedPreviewOpt = q.options.find(
            (o) => o.preview && answer.selectedOptions.includes(o.label)
          );

          return (
            <div key={q.id} className="ask-card__question">
              <div className="ask-card__question-head">
                {questions.length > 1 && (
                  <span className="ask-card__qindex">{qIdx + 1}.</span>
                )}
                <span className="ask-card__question-text">{q.question}</span>
                {q.header && <span className="ask-card__chip">{q.header}</span>}
              </div>

              {q.options.length > 0 && (
                <div className="ask-card__options">
                  {q.options.map((opt, optIdx) => {
                    const isSelected = answer.selectedOptions.includes(opt.label);
                    const isRecommended = q.recommended === optIdx;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        className={`ask-card__option ${isSelected ? 'ask-card__option--selected' : ''}`}
                        onClick={() => handleToggleOption(q, opt.label)}
                      >
                        <span
                          className={`ask-card__indicator ${
                            q.multi ? 'ask-card__indicator--checkbox' : 'ask-card__indicator--radio'
                          } ${isSelected ? 'ask-card__indicator--checked' : ''}`}
                          aria-hidden="true"
                        >
                          {isSelected && (q.multi ? <CheckIcon /> : <span className="ask-card__radio-dot" />)}
                        </span>
                        <span className="ask-card__option-body">
                          <span className="ask-card__option-top">
                            <span className="ask-card__option-label">{opt.label}</span>
                            {isRecommended && (
                              <span className="ask-card__badge-rec">Recommended</span>
                            )}
                          </span>
                          {opt.description && (
                            <span className="ask-card__option-desc">{opt.description}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    className={`ask-card__option ${answer.useOther ? 'ask-card__option--selected' : ''}`}
                    onClick={() => handleToggleOther(q)}
                  >
                    <span
                      className={`ask-card__indicator ${
                        q.multi ? 'ask-card__indicator--checkbox' : 'ask-card__indicator--radio'
                      } ${answer.useOther ? 'ask-card__indicator--checked' : ''}`}
                      aria-hidden="true"
                    >
                      {answer.useOther && (q.multi ? <CheckIcon /> : <span className="ask-card__radio-dot" />)}
                    </span>
                    <span className="ask-card__option-body">
                      <span className="ask-card__option-top">
                        <span className="ask-card__option-label">Other (type your own)</span>
                      </span>
                    </span>
                  </button>
                </div>
              )}

              {(q.options.length === 0 || answer.useOther) && (
                <div className="ask-card__other-wrap">
                  <input
                    type="text"
                    className="ask-card__other-input"
                    placeholder="Type your answer..."
                    value={answer.customInput}
                    onChange={(e) => handleCustomTextChange(q, e.target.value)}
                    autoFocus={q.options.length === 0 || answer.useOther}
                  />
                </div>
              )}

              {selectedPreviewOpt?.preview && (
                <pre className="ask-card__preview">{selectedPreviewOpt.preview}</pre>
              )}
            </div>
          );
        })}
      </div>

      <div className="ask-card__footer">
        <button
          type="button"
          className="ask-card__btn-secondary"
          onClick={handleChatInsteadClick}
          disabled={isSubmitting}
        >
          Chat instead
        </button>
        <button
          type="submit"
          className="ask-card__btn-submit"
          disabled={!allAnswered || isSubmitting}
        >
          {isSubmitting
            ? 'Sending...'
            : questions.length > 1
            ? `Submit Answers (${answeredCount}/${questions.length})`
            : 'Submit Answer'}
        </button>
      </div>
    </form>
  );
}
