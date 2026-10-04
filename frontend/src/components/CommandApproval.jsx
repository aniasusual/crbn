import React from 'react';
import './CommandApproval.css';

const CommandApproval = ({ request, onApprove, onDeny }) => {
  if (!request) return null;

  const { command, reason } = request;

  return (
    <div className="command-approval-inline">
      <div className="modal-header">
        <h3>Command required</h3>
      </div>
      
      <div className="modal-body">
        <p className="reason-text">{reason}</p>
        
        <div className="command-box">
          <code>{command}</code>
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn-deny" onClick={() => onDeny(request.request_id)}>
          Decline
        </button>
        <button className="btn-approve" onClick={() => onApprove(request.request_id)}>
          Allow
        </button>
      </div>
    </div>
  );
};

export default CommandApproval;
