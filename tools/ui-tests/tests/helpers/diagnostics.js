export function attachDiagnostics(page, baseURL) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const externalRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push({ status: response.status(), url: response.url() });
    }
  });

  page.on('request', (request) => {
    if (baseURL && !request.url().startsWith(baseURL)) {
      externalRequests.push(request.url());
    }
  });

  return { consoleErrors, pageErrors, failedRequests, badResponses, externalRequests };
}
