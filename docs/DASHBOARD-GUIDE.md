# Insurer Dashboard Guide

## Overview

The Insurer Dashboard is a web-based interface that allows insurance companies to monitor and manage glass claim assessments in real-time. It provides comprehensive visibility into claim status, automated decisions, and manual review capabilities.

## Access

**URL**: `http://localhost:3000/dashboard`

**Access Code**: `glass2024` (configurable via `DASHBOARD_ACCESS_CODE` in `.env`)

## Features

### 1. Real-Time Metrics

The dashboard displays key performance indicators:

- **Total Claims**: Total number of claims processed
- **Avg Turnaround**: Average time from claim receipt to decision (in hours)
- **Automation Rate**: Percentage of claims processed automatically without manual review
- **Manual Review Queue**: Number of claims currently awaiting manual review
- **Override Rate**: Percentage of manual reviews that overrode the machine decision

### 2. Claims Table

View all claims with the following information:

- **Claim #**: Unique claim identifier
- **Policyholder**: Name of the policyholder
- **Date Received**: When the claim was received from the insurer
- **Date Sent**: When the notification was sent to the policyholder
- **Status**: Current claim status (Message Sent, Photos In Progress, Processing, Result Ready, etc.)
- **Confidence**: Machine confidence score with color coding:
  - 🟢 Green (≥70%): High confidence
  - 🟡 Yellow (60-69%): Medium confidence
  - 🔴 Red (<60%): Low confidence - automatically flagged for manual review
- **Decision**: Automated decision outcome (Repair, Replace, Manual Review, Insufficient Evidence)
- **Actions**: View details and trigger manual review

### 3. Filtering

Filter claims by:

- **Status**: Filter by external status (Message Sent, Photos In Progress, etc.)
- **Decision**: Filter by decision outcome (Repair, Replace, Manual Review)
- **Date Range**: Filter by date received (From/To)

### 4. Claim Details

Click "👁️ View" to see detailed information:

- **Claim Information**: Full claim details including status and timestamps
- **Policyholder Information**: Contact details and VIN
- **Decision Details**: Outcome, confidence scores, and blocking reasons
- **Photos**: Thumbnail previews of all uploaded photos
- **Manual Review Status**: If applicable, shows review status and outcome

### 5. Manual Review Trigger

Click "🔍 Review" to manually trigger a review for any claim:

- **Reason Selection**: Choose from predefined reasons or enter custom reason
  - Low confidence score
  - Complex damage pattern
  - Quality assurance check
  - Customer request
  - Policy exception
  - Other
- **Priority Levels**:
  - **Normal**: Standard review queue
  - **Urgent**: High-priority review
  - **Training**: For training purposes

### 6. Export Functionality

Export claim data for analysis:

- **CSV Export**: Download claims as CSV file for Excel/spreadsheet analysis
- **JSON Export**: Download claims as JSON for programmatic processing
- Exports respect current filters (status, decision, date range)

### 7. Auto-Refresh

The dashboard automatically refreshes every 30 seconds to show the latest data. Manual refresh is also available via the "🔄 Refresh" button.

## API Endpoints

The dashboard uses the following API endpoints:

### Authentication

```
POST /api/dashboard/auth
Body: { "accessCode": "glass2024" }
Response: { "success": true, "message": "Access granted" }
```

### Get Claims

```
GET /api/dashboard/claims?status=&decision=&dateFrom=&dateTo=&limit=100&offset=0
Headers: { "X-Access-Code": "glass2024" }
Response: { "claims": [...], "pagination": {...} }
```

### Get Claim Details

```
GET /api/dashboard/claims/:claimId
Headers: { "X-Access-Code": "glass2024" }
Response: { "id": "...", "claimNumber": "...", ... }
```

### Trigger Manual Review

```
POST /api/dashboard/claims/:claimId/manual-review
Headers: { "X-Access-Code": "glass2024" }
Body: { "reason": "Low confidence score", "priority": "normal" }
Response: { "success": true, "reviewId": "..." }
```

### Get Metrics

```
GET /api/dashboard/metrics
Headers: { "X-Access-Code": "glass2024" }
Response: { "totalClaims": 100, "avgTurnaroundHours": 2.5, ... }
```

### Export Data

```
GET /api/dashboard/export?format=csv&status=&dateFrom=&dateTo=
Headers: { "X-Access-Code": "glass2024" }
Response: CSV or JSON file download
```

## Responsive Design

The dashboard is optimized for:

- **Desktop**: Full-featured experience with all columns visible
- **Tablet**: Responsive layout with horizontal scrolling for table
- **Mobile**: Not optimized (use desktop or tablet)

## Security

### Access Control

- Simple access code authentication for POC
- Access code stored in session storage (cleared on logout)
- All API requests require `X-Access-Code` header

### Production Considerations

For production deployment, consider:

1. **JWT-based authentication** with proper user management
2. **Role-based access control (RBAC)** for different user types
3. **HTTPS enforcement** for all traffic
4. **Rate limiting** on API endpoints
5. **Audit logging** for all dashboard actions
6. **Multi-tenant isolation** for different insurance companies

## Workflow Example

### Typical Insurer Workflow

1. **Login**: Enter access code to access dashboard
2. **Monitor Metrics**: Check overall system performance
3. **Review Claims**: Browse claims table, filter by status/decision
4. **Investigate Low Confidence**: Click on claims with 🔴 red confidence badge
5. **View Details**: Click "👁️ View" to see photos and decision details
6. **Trigger Manual Review**: If needed, click "🔍 Review" and select reason
7. **Export Data**: Download CSV for reporting and analysis
8. **Logout**: Click "🚪 Logout" when done

### Automatic Flagging

Claims are automatically flagged for manual review when:

- Confidence score < 70% (🔴 red badge)
- Decision outcome is "needs_manual_review"
- Blocking reasons prevent automated decision

### Manual Review Process

1. Insurer triggers manual review from dashboard
2. Review is queued with selected priority
3. Machine assessment snapshot is preserved (immutable)
4. Reviewer can:
   - Approve machine result
   - Override to Repair
   - Override to Replace
   - Request photo retake
   - Mark as insufficient evidence
5. Final decision is recorded with override flag

## Troubleshooting

### Cannot Login

- Verify access code matches `DASHBOARD_ACCESS_CODE` in `.env`
- Check browser console for errors
- Ensure server is running on port 3000

### Claims Not Loading

- Check server logs for errors
- Verify database connection
- Check browser console for API errors
- Ensure `X-Access-Code` header is being sent

### Photos Not Displaying

- Verify photo file paths are correct
- Check that photos are stored in `uploads/photos/` directory
- Ensure static file serving is configured correctly

### Export Not Working

- Check that claims exist with current filters
- Verify browser allows file downloads
- Check server logs for export errors

## Development

### File Structure

```
public/
├── dashboard.html          # Main dashboard HTML
├── css/
│   └── dashboard.css       # Dashboard styles
└── js/
    └── dashboard.js        # Dashboard JavaScript

src/
└── routes/
    └── dashboard.ts        # Dashboard API routes
```

### Adding New Features

1. **Backend**: Add new endpoints to `src/routes/dashboard.ts`
2. **Frontend**: Update `public/js/dashboard.js` for new functionality
3. **Styling**: Add styles to `public/css/dashboard.css`
4. **Testing**: Test with real data and various scenarios

### Configuration

Environment variables in `.env`:

```bash
# Dashboard Configuration
DASHBOARD_ACCESS_CODE=glass2024
```

## Future Enhancements

Planned improvements for production:

1. **Real-time Updates**: WebSocket integration for live updates
2. **Advanced Analytics**: Charts and graphs for trend analysis
3. **Bulk Operations**: Process multiple claims at once
4. **Custom Reports**: Generate custom reports with filters
5. **User Management**: Multi-user support with roles and permissions
6. **Notifications**: Email/SMS alerts for important events
7. **Audit Trail**: Complete history of all dashboard actions
8. **Mobile App**: Native mobile app for on-the-go access

## Support

For issues or questions:

1. Check server logs: `logs/app.log`
2. Check browser console for JavaScript errors
3. Verify database connectivity
4. Review API endpoint responses

## Changelog

### Version 1.0.0 (Current)

- Initial dashboard implementation
- Claims listing with filters
- Claim detail view with photos
- Manual review trigger
- CSV/JSON export
- Auto-refresh (30 seconds)
- Simple access code authentication
- Responsive design (desktop + tablet)
