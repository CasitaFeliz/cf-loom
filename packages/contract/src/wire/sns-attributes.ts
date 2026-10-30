/** The SNS message attribute a Message's subject travels in, which each Durable consumer's subscription filters on. */
export const snsSubjectAttribute = 'cf-loom-subject';

/** The SNS message attribute the Broker message id travels in. */
export const snsMessageIdAttribute = 'cf-loom-message-id';

/** The SNS message attribute the Fact id travels in. */
export const snsFactIdAttribute = 'cf-loom-fact-id';

/** The SNS message attribute the Message's Broker headers travel in. */
export const snsHeadersAttribute = 'cf-loom-headers';
