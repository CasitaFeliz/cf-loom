/** The AWS errors cf-loom tells by name, which is how the SDK says that a queue or a topic does not exist. */
type AwsErrorName = 'QueueDoesNotExist' | 'NotFoundException';

/** Whether the AWS client failed with this error, by the error's name, since a second copy of the SDK in the tree makes `instanceof` miss. */
export function isAwsError(error: unknown, name: AwsErrorName): boolean {
  return error instanceof Error && error.name === name;
}

/** What AWS answered for a field it always sends, or an error naming the field it left out. */
export function answeredWith<Answer>(answer: Answer | undefined, field: string): Answer {
  if (answer === undefined) {
    throw new Error(`AWS answered no ${field}`);
  }
  return answer;
}
