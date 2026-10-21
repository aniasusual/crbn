import React, { useState, useCallback } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import './PlanProposalCard.css';

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const ExpandIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9"></polyline>
    <polyline points="9 21 3 21 3 15"></polyline>
    <line x1="21" y1="3" x2="14" y2="10"></line>
    <line x1="3" y1="21" x2="10" y2="14"></line>
  </svg>
);

const CollapseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20"></polyline>
    <polyline points="20 10 14 10 14 4"></polyline>
    <line x1="14" y1="10" x2="21" y2="3"></line>
    <line x1="3" y1="21" x2="10" y2="14"></line>
  </svg>
);

export default function PlanProposalCard({ proposal, onApprove, onRefine }) {
  const [isRefining, setIsRefining] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const planContent = proposal?.plan_content;

  const handleCopy = useCallback(async () => {
    if (!planContent) return;
    try {
      await navigator.clipboard.writeText(planContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }, [planContent]);

  if (!proposal) return null;

  const { title, plan_path: planPath, request_id: requestId } = proposal;
  const handleSendFeedback = (e) => {
    e.preventDefault();
    if (!feedback.trim()) return;
    onRefine?.(requestId, feedback.trim());
    setFeedback('');
    setIsRefining(false);
  };

  return (
    <div className={`plan-proposal-card ${isExpanded ? 'plan-proposal-card--expanded' : ''}`}>
      {/* Top Header Row with Metadata and Window Controls */}
      <div className="plan-proposal-card__header">
        <div className="plan-proposal-card__header-left">
          <div className="plan-proposal-card__icon-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div className="plan-proposal-card__title-group">
            <div className="plan-proposal-card__title-row">
              <h3 className="plan-proposal-card__heading">{title || 'Proposed Plan'}</h3>
              <span className="plan-proposal-card__badge">Plan Proposal</span>
              {planPath && <span className="plan-proposal-card__file">{planPath}</span>}
            </div>
            <span className="plan-proposal-card__subtext">
              Review architecture and execution steps before building
            </span>
          </div>
        </div>

        <div className="plan-proposal-card__header-actions">
          <button
            type="button"
            className="plan-proposal-card__icon-btn"
            onClick={handleCopy}
            title={copied ? 'Copied to clipboard' : 'Copy plan markdown'}
            aria-label="Copy plan markdown"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            className="plan-proposal-card__icon-btn"
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse plan' : 'Expand plan'}
          >
            {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
            <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
        </div>
      </div>

      {/* Scrollable Markdown Document Canvas */}
      <div className={`plan-proposal-card__body ${isExpanded ? 'plan-proposal-card__body--expanded' : ''}`}>
        {planContent ? (
          <div className="plan-proposal-card__content">
            <MarkdownRenderer content={planContent} />
          </div>
        ) : (
          <p className="plan-proposal-card__empty">Plan file ready for review at {planPath}.</p>
        )}
      </div>

      {/* Interactive Decision / Refinement Ribbon */}
      {isRefining ? (
        <form className="plan-proposal-card__refine-form" onSubmit={handleSendFeedback}>
          <textarea
            className="plan-proposal-card__refine-input"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what to refine (e.g. add token rotation, change schema, or specify fallback steps)..."
            autoFocus
            rows={3}
          />
          <div className="plan-proposal-card__refine-actions">
            <button
              type="button"
              className="plan-proposal-card__btn-cancel"
              onClick={() => {
                setIsRefining(false);
                setFeedback('');
              }}
            >
              Back
            </button>
            <button
              type="submit"
              className="plan-proposal-card__btn-send-refine"
              disabled={!feedback.trim()}
            >
              Submit Feedback
            </button>
          </div>
        </form>
      ) : (
        <div className="plan-proposal-card__footer">
          <button
            type="button"
            className="plan-proposal-card__btn-refine"
            onClick={() => setIsRefining(true)}
            title="Ask the agent to adjust or expand this plan before building"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
            <span>Request Changes</span>
          </button>

          <button
            type="button"
            className="plan-proposal-card__btn-approve"
            onClick={() => onApprove?.(requestId)}
            title="Approve plan and begin execution (Build Mode)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span>Approve &amp; Build</span>
          </button>
        </div>
      )}
    </div>
  );
}
