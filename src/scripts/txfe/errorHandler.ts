export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
}

type NotificationCallback = (notification: Notification) => void;

class ErrorHandler {
  private subscribers: NotificationCallback[] = [];
  private notificationCounter = 0;

  subscribe(callback: NotificationCallback): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((sub) => sub !== callback);
    };
  }

  private notify(type: NotificationType, message: string, duration = 5000): void {
    const notification: Notification = {
      id: `notification-${++this.notificationCounter}`,
      type,
      message,
      duration,
    };

    this.subscribers.forEach((callback) => callback(notification));
  }

  success(message: string, duration?: number): void {
    this.notify('success', message, duration);
  }

  error(message: string, duration?: number): void {
    this.notify('error', message, duration);
  }

  warning(message: string, duration?: number): void {
    this.notify('warning', message, duration);
  }

  info(message: string, duration?: number): void {
    this.notify('info', message, duration);
  }
}

export const errorHandler = new ErrorHandler();
